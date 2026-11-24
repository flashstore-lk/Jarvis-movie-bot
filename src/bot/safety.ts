
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import type { WASocket } from "@whiskeysockets/baileys";
import { env } from "../config/env";

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const AUTH_DIR = env.authDir || "/app/auth_info";

const SAFETY_FILE = path.join(
  AUTH_DIR,
  "jarvis-safety.json"
);

const MAX_MESSAGES_PER_MINUTE = 10;
const MAX_SEEN_MESSAGE_IDS = 10000;
const MAX_PENDING_OUTGOING = 100;

const OUTGOING_INTERVAL_MS = 1200;

// --------------------------------------------------
// STATE
// --------------------------------------------------

const optedOutJids = new Set<string>();

const rateBuckets = new Map<string, number[]>();

const seenMessageIds = new Set<string>();

let loaded = false;
let loading: Promise<void> | null = null;

let persistQueue: Promise<void> = Promise.resolve();

let outgoingQueue: Promise<void> = Promise.resolve();

let pendingOutgoing = 0;
let lastOutgoingAt = 0;

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jidTag(jid: string): string {
  return createHash("sha256")
    .update(jid)
    .digest("hex")
    .slice(0, 12);
}

// --------------------------------------------------
// LOAD PERSISTENT OPT-OUT DATA
// --------------------------------------------------

async function ensureLoaded(): Promise<void> {
  if (loaded) {
    return;
  }

  if (loading) {
    await loading;
    return;
  }

  loading = (async () => {
    await mkdir(AUTH_DIR, {
      recursive: true
    });

    try {
      const raw = await readFile(
        SAFETY_FILE,
        "utf8"
      );

      const parsed: unknown = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        throw new Error(
          "Invalid safety state file format."
        );
      }

      for (const jid of parsed) {
        if (typeof jid === "string") {
          optedOutJids.add(jid);
        }
      }

    } catch (error) {
      const code = (
        error as NodeJS.ErrnoException
      ).code;

      if (code !== "ENOENT") {
        throw error;
      }
    }

    loaded = true;

    console.log(
      `[Safety] Loaded ${optedOutJids.size} opt-out records.`
    );
  })();

  try {
    await loading;
  } finally {
    loading = null;
  }
}

// --------------------------------------------------
// SAVE OPT-OUT DATA
// --------------------------------------------------

async function persistOptOuts(): Promise<void> {
  const snapshot = JSON.stringify(
    [...optedOutJids],
    null,
    2
  );

  persistQueue = persistQueue
    .catch(error => {
      console.error(
        "[Safety] Previous save failed:",
        error
      );
    })
    .then(async () => {
      await mkdir(AUTH_DIR, {
        recursive: true
      });

      const tempFile = `${SAFETY_FILE}.tmp`;

      await writeFile(
        tempFile,
        snapshot,
        {
          encoding: "utf8",
          mode: 0o600
        }
      );

      await rename(
        tempFile,
        SAFETY_FILE
      );
    });

  await persistQueue;
}

// --------------------------------------------------
// OPT-OUT MANAGEMENT
// --------------------------------------------------

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
    `[Safety] ${
      optedOut ? "STOP" : "START"
    } saved for ${jidTag(jid)}`
  );
}

export async function isOptedOut(
  jid: string
): Promise<boolean> {
  await ensureLoaded();

  return optedOutJids.has(jid);
}

// --------------------------------------------------
// STOP / START COMMAND HANDLING
// --------------------------------------------------

export async function handleConsentCommand(
  sock: WASocket,
  jid: string,
  text: string
): Promise<boolean> {
  const command = text.trim().toUpperCase();

  if (
    command === "STOP" ||
    command === "UNSUBSCRIBE"
  ) {
    await setOptOut(jid, true);

    await safeSendText(
      sock,
      jid,
      "ඔබගේ STOP ඉල්ලීම සටහන් කළා. දැන් Bot replies නවතා ඇත. නැවත ආරම්භ කිරීමට START යවන්න."
    );

    return true;
  }

  if (
    command === "START" ||
    command === "SUBSCRIBE"
  ) {
    await setOptOut(jid, false);

    await safeSendText(
      sock,
      jid,
      "J.A.R.V.I.S. Movie Bot නැවත සක්‍රීයයි. Movie එකක නමක් හෝ IMDb ID එකක් යවන්න."
    );

    return true;
  }

  // Do not reply to users who opted out.
  if (await isOptedOut(jid)) {
    return true;
  }

  return false;
}

// --------------------------------------------------
// DUPLICATE MESSAGE PROTECTION
// --------------------------------------------------

export function shouldProcessMessage(
  jid: string,
  messageId?: string | null
): boolean {
  if (!messageId) {
    return true;
  }

  const key = `${jid}:${messageId}`;

  if (seenMessageIds.has(key)) {
    console.warn(
      `[Safety] Duplicate ignored: ${jidTag(jid)}`
    );

    return false;
  }

  seenMessageIds.add(key);

  if (
    seenMessageIds.size > MAX_SEEN_MESSAGE_IDS
  ) {
    const oldest = seenMessageIds
      .values()
      .next()
      .value;

    if (oldest) {
      seenMessageIds.delete(oldest);
    }
  }

  return true;
}

// --------------------------------------------------
// INBOUND RATE LIMIT
// --------------------------------------------------

export function isWithinInboundLimit(
  jid: string
): boolean {
  const now = Date.now();

  const windowStart = now - 60_000;

  const recent = (
    rateBuckets.get(jid) || []
  ).filter(timestamp => timestamp > windowStart);

  if (
    recent.length >= MAX_MESSAGES_PER_MINUTE
  ) {
    rateBuckets.set(jid, recent);

    console.warn(
      `[Safety] Rate limit reached: ${jidTag(jid)}`
    );

    return false;
  }

  recent.push(now);

  rateBuckets.set(jid, recent);

  // Keep memory usage bounded.
  if (rateBuckets.size > 5000) {
    const oldest = rateBuckets
      .keys()
      .next()
      .value;

    if (oldest) {
      rateBuckets.delete(oldest);
    }
  }

  return true;
}

// --------------------------------------------------
// CONTROLLED OUTGOING MESSAGE QUEUE
// --------------------------------------------------

export function safeSendText(
  sock: WASocket,
  jid: string,
  text: string
): Promise<void> {
  if (pendingOutgoing >= MAX_PENDING_OUTGOING) {
    console.warn(
      "[Safety] Outgoing queue is full."
    );

    return Promise.reject(
      new Error(
        "Outgoing message queue is full."
      )
    );
  }

  pendingOutgoing += 1;

  const task = outgoingQueue
    .then(async () => {
      const elapsed =
        Date.now() - lastOutgoingAt;

      const waitTime = Math.max(
        0,
        OUTGOING_INTERVAL_MS - elapsed
      );

      if (waitTime > 0) {
        await delay(waitTime);
      }

      await sock.sendMessage(jid, {
        text
      });

      lastOutgoingAt = Date.now();
    })
    .finally(() => {
      pendingOutgoing -= 1;
    });

  // Prevent one failed send from blocking the queue.
  outgoingQueue = task.catch(error => {
    console.error(
      "[Safety] Outgoing message failed:",
      error
    );
  });

  return task;
}
