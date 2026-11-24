import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { WASocket } from "@whiskeysockets/baileys";
import { env } from "../config/env";

const AUTH_DIR = env.authDir || "/app/auth_info";
const SAFETY_FILE = path.join(AUTH_DIR, "jarvis-safety.json");

const MAX_MESSAGES_PER_MINUTE = 10;
const MAX_SEEN_MESSAGE_IDS = 10000;
const MAX_PENDING_OUTGOING = 100;
const OUTGOING_INTERVAL_MS = 1200;

const optedOutJids = new Set<string>();
const rateBuckets = new Map<string, number[]>();
const seenMessageIds = new Set<string>();

let loaded = false;
let loading: Promise<void> | null = null;

let persistQueue: Promise<void> = Promise.resolve();
let outgoingQueue: Promise<void> = Promise.resolve();

let pendingOutgoing = 0;
let lastOutgoingAt = 0;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jidTag(jid: string): string {
  return createHash("sha256")
    .update(jid)
    .digest("hex")
    .slice(0, 12);
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;

  if (loading) {
    await loading;
    return;
  }

  loading = (async () => {
    await mkdir(AUTH_DIR, { recursive: true });

    try {
      const raw = await readFile(SAFETY_FILE, "utf8");
      const parsed: unknown = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        throw new Error("Invalid safety state file.");
      }

      for (const jid of parsed) {
        if (typeof jid === "string") {
          optedOutJids.add(jid);
        }
      }
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw error;
      }
    }

    loaded = true;
    console.log("[Safety] Opt-out records loaded.");
  })();

  try {
    await loading;
  } finally {
    loading = null;
  }
}

async function persistOptOuts(): Promise<void> {
  const snapshot = JSON.stringify(
    [...optedOutJids],
    null,
    2
  );

  persistQueue = persistQueue.then(async () => {
    await mkdir(AUTH_DIR, { recursive: true });

    const tempFile = `${SAFETY_FILE}.tmp`;

    await writeFile(tempFile, snapshot, {
      encoding: "utf8",
      mode: 0o600
    });

    await rename(tempFile, SAFETY_FILE);
  });

  await persistQueue;
}

async function setOptOut(
  jid: string,
  optedOut: boolean
): Promise<void> {
  await ensureLoaded();

  if (optedOut) {
    optedOutJids.add(jid);
  } else {
    optedOutJids.delete(jid);
  }

  await persistOptOuts();

  console.log(
    `[Safety] ${optedOut ? "STOP" : "START"} saved for ${jidTag(jid)}`
  );
}

export async function isOptedOut(
  jid: string
): Promise<boolean> {
  await ensureLoaded();
  return optedOutJids.has(jid);
}

/**
 * Handles STOP / START commands.
 * Returns true when the message should not go to movie search.
 */
export async function handleConsentCommand(
  sock: WASocket,
  jid: string,
  text: string
): Promise<boolean> {
  const command = text.trim().toUpperCase();

  if (command === "STOP" || command === "UNSUBSCRIBE") {
    await setOptOut(jid, true);

    await safeSendText(
      sock,
      jid,
      "ඔබගේ STOP ඉල්ලීම සුරක්ෂිතව සටහන් කළා. දැන් Bot replies නවතා ඇත. නැවත ආරම්භ කිරීමට START යවන්න."
    );

    return true;
  }

  if (command === "START" || command === "SUBSCRIBE") {
    await setOptOut(jid, false);

    await safeSendText(
      sock,
      jid,
      "J.A.R.V.I.S. Movie Bot නැවත සක්‍රීයයි. Movie එකක නමක් හෝ IMDb ID එකක් යවන්න."
    );

    return true;
  }

  // A user who opted out receives no other bot replies.
  if (await isOptedOut(jid)) {
    return true;
  }

  return false;
}

/**
 * Prevents the same WhatsApp message from being processed twice.
 */
export function shouldProcessMessage(
  jid: string,
  messageId?: string | null
): boolean {
  if (!messageId) return true;

  const key = `${jid}:${messageId}`;

  if (seenMessageIds.has(key)) {
    console.warn(
      `[Safety] Duplicate message ignored: ${jidTag(jid)}`
    );

    return false;
  }

  seenMessageIds.add(key);

  if (seenMessageIds.size > MAX_SEEN_MESSAGE_IDS) {
    const oldest = seenMessageIds.values().next().value;

    if (oldest) {
      seenMessageIds.delete(oldest);
    }
  }

  return true;
}

/**
 * Limits inbound commands per WhatsApp user.
 * STOP and START are handled before this check.
 */
export function isWithinInboundLimit(jid: string): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;

  const recent = (rateBuckets.get(jid) || [])
    .filter(timestamp => timestamp > windowStart);

  if (recent.length >= MAX_MESSAGES_PER_MINUTE) {
    rateBuckets.set(jid, recent);

    console.warn(
      `[Safety] Inbound rate limit reached: ${jidTag(jid)}`
    );

    return false;
  }

  recent.push(now);
  rateBuckets.set(jid, recent);

  if (rateBuckets.size > 5000) {
    const oldest = rateBuckets.keys().next().value;

    if (oldest) {
      rateBuckets.delete(oldest);
    }
  }

  return true;
}

/**
 * Sends text replies through one bounded queue.
 * This is for orderly delivery, not for bypassing platform limits.
 */
export function safeSendText(
  sock: WASocket,
  jid: string,
  text: string
): Promise<void> {
  if (pendingOutgoing >= MAX_PENDING_OUTGOING) {
    console.warn("[Safety] Outgoing queue is full.");
    return Promise.reject(
      new Error("Outgoing message queue is full.")
    );
  }

  pendingOutgoing += 1;

  const task = outgoingQueue
    .then(async () => {
      const elapsed = Date.now() - lastOutgoingAt;
      const waitTime = Math.max(
        0,
        OUTGOING_INTERVAL_MS - elapsed
      );

      if (waitTime > 0) {
        await delay(waitTime);
      }

      await sock.sendMessage(jid, { text });

      lastOutgoingAt = Date.now();
    })
    .finally(() => {
      pendingOutgoing -= 1;
    });

  // Keep the queue usable after an individual send fails.
  outgoingQueue = task.catch(error => {
    console.error(
      "[Safety] Outgoing message failed:",
      error
    );
  });

  return task;
}
