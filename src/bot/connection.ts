
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  type WASocket
} from "@whiskeysockets/baileys";

import pino from "pino";

import {
  mkdir,
  readdir,
  unlink
} from "node:fs/promises";

import path from "node:path";

import { env } from "../config/env";
import { handleMessage } from "./commands";
import { shouldProcessMessage } from "./safety";

// --------------------------------------------------
// TYPES
// --------------------------------------------------

type ConnectionState =
  | "idle"
  | "connecting"
  | "qr"
  | "open"
  | "closed"
  | "logged_out";

// --------------------------------------------------
// STATE
// --------------------------------------------------

let currentSocket: WASocket | null = null;

let connectionState: ConnectionState = "idle";

let latestQr: string | null = null;

let reconnectTimer: NodeJS.Timeout | null = null;

let reconnectDelay = 2000;

let stopped = false;
let connecting = false;
let pairingRequestInProgress = false;

let socketGeneration = 0;

let authCleanupPromise: Promise<void> | null = null;

const AUTH_DIR = env.authDir || "/app/auth_info";

const PAIRING_READY_TIMEOUT = 60000;
const PAIRING_SETTLE_DELAY = 3000;

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function getDisconnectDetails(error: unknown) {
  const err = error as any;

  return {
    name: err?.name || "UnknownError",
    message: err?.message || String(error),
    statusCode: err?.output?.statusCode ?? null,
    payload: err?.output?.payload ?? null
  };
}

// --------------------------------------------------
// STATUS
// --------------------------------------------------

export function getWhatsAppStatus() {
  return {
    connected: connectionState === "open",
    state: connectionState,

    account:
      connectionState === "open"
        ? currentSocket?.user?.id || null
        : null,

    hasQr: Boolean(latestQr),

    connecting:
      connectionState === "connecting" ||
      connectionState === "qr"
  };
}

export function getLatestQr(): string | null {
  return latestQr;
}

// --------------------------------------------------
// AUTH CLEANUP
// --------------------------------------------------

async function clearLoggedOutAuthFiles(): Promise<void> {
  if (authCleanupPromise) {
    await authCleanupPromise;
    return;
  }

  authCleanupPromise = (async () => {
    await mkdir(AUTH_DIR, { recursive: true });

    const entries = await readdir(
      AUTH_DIR,
      { withFileTypes: true }
    );

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      if (
        entry.name === "jarvis-safety.json" ||
        entry.name === "jarvis-safety.json.tmp"
      ) {
        continue;
      }

      await unlink(path.join(AUTH_DIR, entry.name));
    }

    console.log(
      "[Connection] Old auth files cleared. Safety data preserved."
    );
  })();

  try {
    await authCleanupPromise;
  } finally {
    authCleanupPromise = null;
  }
}

// --------------------------------------------------
// RESET LOGGED OUT SESSION
// --------------------------------------------------

async function resetLoggedOutSession(): Promise<void> {
  stopped = true;

  clearReconnectTimer();

  socketGeneration++;

  currentSocket = null;
  latestQr = null;

  await clearLoggedOutAuthFiles();

  connectionState = "idle";
  stopped = false;

  console.log(
    "[Connection] Logged-out session reset."
  );
}

// --------------------------------------------------
// START WHATSAPP
// --------------------------------------------------

export async function startWhatsApp(): Promise<void> {
  if (connecting) return;

  if (
    currentSocket &&
    (
      connectionState === "connecting" ||
      connectionState === "qr" ||
      connectionState === "open"
    )
  ) {
    return;
  }

  if (connectionState === "logged_out") {
    await resetLoggedOutSession();
  }

  stopped = false;

  clearReconnectTimer();

  await connect();
}

// --------------------------------------------------
// REQUEST PAIRING CODE
// --------------------------------------------------

export async function requestWhatsAppPairingCode(
  phoneNumber: string
): Promise<string> {
  const cleanNumber = phoneNumber.replace(/\D/g, "");

  if (!/^\d{8,15}$/.test(cleanNumber)) {
    throw new Error(
      "Enter a valid phone number with country code."
    );
  }

  if (pairingRequestInProgress) {
    throw new Error(
      "A pairing request is already processing."
    );
  }

  if (connectionState === "open") {
    throw new Error(
      "WhatsApp is already connected."
    );
  }

  pairingRequestInProgress = true;

  try {
    if (connectionState === "logged_out") {
      await resetLoggedOutSession();
    }

    if (
      !currentSocket ||
      connectionState === "closed" ||
      connectionState === "idle"
    ) {
      await startWhatsApp();
    }

    const sock = await waitForPairingReady();

    await delay(PAIRING_SETTLE_DELAY);

    if (
      currentSocket !== sock ||
      connectionState === "closed" ||
      connectionState === "logged_out" ||
      connectionState === "open"
    ) {
      throw new Error(
        "WhatsApp connection changed before pairing."
      );
    }

    console.log(
      "[Connection] Requesting pairing code."
    );

    const code = await sock.requestPairingCode(
      cleanNumber
    );

    latestQr = null;

    console.log(
      "[Connection] Pairing code generated successfully."
    );

    return code;

  } catch (error) {
    console.error(
      "[Connection] Pairing failed:",
      getDisconnectDetails(error)
    );

    throw error;

  } finally {
    pairingRequestInProgress = false;
  }
}

// --------------------------------------------------
// WAIT FOR PAIRING READY
// --------------------------------------------------

async function waitForPairingReady(
  timeoutMs = PAIRING_READY_TIMEOUT
): Promise<WASocket> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (stopped || connectionState === "logged_out") {
      throw new Error("WhatsApp session logged out.");
    }

    if (connectionState === "open") {
      throw new Error("WhatsApp is already connected.");
    }

    if (connectionState === "closed" && !connecting) {
      throw new Error("WhatsApp connection closed.");
    }

    // Baileys emits QR event when pairing is ready.
    if (
      currentSocket &&
      latestQr &&
      connectionState === "qr"
    ) {
      return currentSocket;
    }

    if (!currentSocket && !connecting) {
      await startWhatsApp();
    }

    await delay(250);
  }

  throw new Error(
    "WhatsApp pairing initialization timed out."
  );
}

// --------------------------------------------------
// RECONNECT
// --------------------------------------------------

function scheduleReconnect(): void {
  if (
    stopped ||
    reconnectTimer ||
    connectionState === "logged_out"
  ) {
    return;
  }

  const waitTime = reconnectDelay;

  console.log(
    `[Connection] Reconnecting in ${Math.round(waitTime / 1000)} seconds.`
  );

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    if (
      stopped ||
      connecting ||
      currentSocket ||
      connectionState === "logged_out"
    ) {
      return;
    }

    try {
      await connect();
    } catch (error) {
      console.error(
        "[Connection] Reconnect failed:",
        getDisconnectDetails(error)
      );

      scheduleReconnect();
    }
  }, waitTime);

  reconnectDelay = Math.min(
    reconnectDelay * 2,
    60000
  );
}

// --------------------------------------------------
// CONNECT
// --------------------------------------------------

async function connect(): Promise<void> {
  if (connecting || stopped) return;

  connecting = true;
  connectionState = "connecting";

  const generation = ++socketGeneration;

  try {
    await mkdir(AUTH_DIR, { recursive: true });

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(AUTH_DIR);

    // IMPORTANT:
    // Fetch the actual WhatsApp Web version.
    // Do not silently use an outdated fallback version.

    console.log(
      "[Connection] Fetching current WhatsApp Web version..."
    );

    const versionResult =
      await fetchLatestWaWebVersion({
        timeout: 15000
      });

    if (!versionResult.isLatest) {
      console.error(
        "[Connection] Could not fetch current WhatsApp Web version."
      );

      throw new Error(
        "Current WhatsApp Web version unavailable. Refusing to connect with an outdated version."
      );
    }

    const version = versionResult.version;

    console.log(
      `[Connection] WhatsApp Web version: ${version.join(".")}`
    );

    if (
      stopped ||
      generation !== socketGeneration
    ) {
      return;
    }

    const sock = makeWASocket({
      version,

      auth: state,

      logger: pino({
        level: "silent"
      }),

      printQRInTerminal: false,

      browser: [
        "JARVIS Movie Bot",
        "Chrome",
        "1.0.0"
      ],

      markOnlineOnConnect: false,

      keepAliveIntervalMs: 30000,

      connectTimeoutMs: 60000,

      defaultQueryTimeoutMs: 60000
    });

    currentSocket = sock;

    connectionState = "connecting";
    latestQr = null;

    // --------------------------------------------------
    // SAVE CREDS
    // --------------------------------------------------

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    // --------------------------------------------------
    // CONNECTION EVENTS
    // --------------------------------------------------

    sock.ev.on(
      "connection.update",
      update => {
        if (
          currentSocket !== sock ||
          generation !== socketGeneration
        ) {
          return;
        }

        const {
          connection,
          lastDisconnect,
          qr
        } = update;

        if (connection === "connecting") {
          connectionState = "connecting";

          console.log(
            "[Connection] WhatsApp connecting..."
          );
        }

        if (qr) {
          latestQr = qr;

          if (connectionState !== "open") {
            connectionState = "qr";
          }

          console.log(
            "[Connection] Pairing QR event received."
          );
        }

        if (connection === "open") {
          connectionState = "open";

          latestQr = null;

          reconnectDelay = 2000;
          stopped = false;

          clearReconnectTimer();

          console.log(
            "[Connection] WhatsApp connected successfully."
          );
        }

        if (connection === "close") {
          const details = getDisconnectDetails(
            lastDisconnect?.error
          );

          const statusCode = details.statusCode;

          latestQr = null;

          if (currentSocket === sock) {
            currentSocket = null;
          }

          console.error(
            "[Connection] Disconnect details:",
            details
          );

          if (
            statusCode === DisconnectReason.loggedOut
          ) {
            connectionState = "logged_out";
            stopped = true;

            clearReconnectTimer();

            socketGeneration++;

            console.error(
              "[Connection] WhatsApp logged out."
            );

            void clearLoggedOutAuthFiles().catch(error => {
              console.error(
                "[Connection] Auth cleanup failed:",
                getDisconnectDetails(error)
              );
            });

            return;
          }

          connectionState = "closed";

          console.error(
            `[Connection] WhatsApp disconnected. Status: ${statusCode ?? "unknown"}`
          );

          scheduleReconnect();
        }
      }
    );

    // --------------------------------------------------
    // INCOMING MESSAGES
    // --------------------------------------------------

    sock.ev.on(
      "messages.upsert",
      async ({ messages, type }) => {
        if (type !== "notify") return;

        if (
          currentSocket !== sock ||
          generation !== socketGeneration ||
          connectionState !== "open"
        ) {
          return;
        }

        for (const msg of messages) {
          if (
            !msg.message ||
            msg.key.fromMe ||
            !msg.key.remoteJid
          ) {
            continue;
          }

          const jid = msg.key.remoteJid;

          if (
            jid.endsWith("@g.us") ||
            jid.endsWith("@broadcast") ||
            jid === "status@broadcast"
          ) {
            continue;
          }

          if (
            !shouldProcessMessage(
              jid,
              msg.key.id
            )
          ) {
            continue;
          }

          const body =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";

          if (!body.trim()) continue;

          try {
            await handleMessage(
              sock,
              jid,
              body
            );
          } catch (error) {
            console.error(
              "[Bot] Message processing failed:",
              getDisconnectDetails(error)
            );
          }
        }
      }
    );

  } catch (error) {
    connectionState = "closed";
    latestQr = null;

    console.error(
      "[Connection] Initialization failed:",
      getDisconnectDetails(error)
    );

    if (!stopped) {
      scheduleReconnect();
    }

  } finally {
    connecting = false;
  }
}
