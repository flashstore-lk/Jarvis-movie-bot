
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
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

function getConnectionState(): ConnectionState {
  return connectionState;
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
// AUTH FILE CLEANUP
// --------------------------------------------------

async function clearLoggedOutAuthFiles(): Promise<void> {
  if (authCleanupPromise) {
    await authCleanupPromise;
    return;
  }

  authCleanupPromise = (async () => {
    await mkdir(AUTH_DIR, {
      recursive: true
    });

    const entries = await readdir(
      AUTH_DIR,
      {
        withFileTypes: true
      }
    );

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      // Never delete bot safety data.
      if (
        entry.name === "jarvis-safety.json" ||
        entry.name === "jarvis-safety.json.tmp"
      ) {
        continue;
      }

      await unlink(
        path.join(AUTH_DIR, entry.name)
      );
    }

    console.log(
      "[Connection] Logged-out auth files cleared. Safety data preserved."
    );
  })();

  try {
    await authCleanupPromise;
  } finally {
    authCleanupPromise = null;
  }
}

// --------------------------------------------------
// RESET LOGGED-OUT SESSION
// --------------------------------------------------

async function resetLoggedOutSession(): Promise<void> {
  stopped = true;

  clearReconnectTimer();

  // Invalidate events from the old socket.
  socketGeneration += 1;

  currentSocket = null;
  latestQr = null;

  await clearLoggedOutAuthFiles();

  connectionState = "idle";

  stopped = false;

  console.log(
    "[Connection] Old WhatsApp session reset."
  );
}

// --------------------------------------------------
// START WHATSAPP
// --------------------------------------------------

export async function startWhatsApp(): Promise<void> {
  if (connecting) {
    return;
  }

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
      "A pairing request is already processing. Please wait."
    );
  }

  if (getConnectionState() === "open") {
    throw new Error(
      "WhatsApp is already connected."
    );
  }

  pairingRequestInProgress = true;

  try {
    if (getConnectionState() === "logged_out") {
      await resetLoggedOutSession();
    }

    if (
      !currentSocket ||
      getConnectionState() === "closed" ||
      getConnectionState() === "idle"
    ) {
      await startWhatsApp();
    }

    const sock = await waitForPairingReady();

    await delay(PAIRING_SETTLE_DELAY);

    const latestState = getConnectionState();

    if (
      currentSocket !== sock ||
      latestState === "closed" ||
      latestState === "logged_out" ||
      latestState === "open"
    ) {
      throw new Error(
        "WhatsApp connection changed before pairing. Please try again."
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
    const details = getDisconnectDetails(error);

    console.error(
      "[Connection] Pairing request failed:",
      details
    );

    throw error;

  } finally {
    pairingRequestInProgress = false;
  }
}

// --------------------------------------------------
// WAIT FOR PAIRING SOCKET
// --------------------------------------------------

async function waitForPairingReady(
  timeoutMs = PAIRING_READY_TIMEOUT
): Promise<WASocket> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = getConnectionState();

    if (stopped || state === "logged_out") {
      throw new Error(
        "WhatsApp session logged out. Please retry."
      );
    }

    if (state === "open") {
      throw new Error(
        "WhatsApp is already connected."
      );
    }

    if (state === "closed" && !connecting) {
      throw new Error(
        "WhatsApp connection closed before pairing was ready."
      );
    }

    // Wait for Baileys to emit its QR event.
    if (
      currentSocket &&
      latestQr &&
      state === "qr"
    ) {
      return currentSocket;
    }

    if (!currentSocket && !connecting) {
      await startWhatsApp();
    }

    await delay(250);
  }

  throw new Error(
    "WhatsApp connection timed out. Please try again."
  );
}

// --------------------------------------------------
// RECONNECT
// --------------------------------------------------

function scheduleReconnect(): void {
  if (
    stopped ||
    reconnectTimer ||
    getConnectionState() === "logged_out"
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
      getConnectionState() === "logged_out"
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
  if (connecting || stopped) {
    return;
  }

  connecting = true;

  connectionState = "connecting";

  const generation = ++socketGeneration;

  try {
    await mkdir(AUTH_DIR, {
      recursive: true
    });

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(AUTH_DIR);

    const { version } =
      await fetchLatestBaileysVersion();

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
    // SAVE CREDENTIALS
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
        // Ignore events from old sockets.
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
            "[Connection] WhatsApp connection is starting."
          );
        }

        if (qr) {
          latestQr = qr;

          if (getConnectionState() !== "open") {
            connectionState = "qr";
          }

          console.log(
            "[Connection] QR code is ready."
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
          const disconnectError =
            lastDisconnect?.error;

          const details =
            getDisconnectDetails(disconnectError);

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

            socketGeneration += 1;

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

          // Restart-required and temporary disconnects
          // use the bounded reconnect schedule.
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
        if (type !== "notify") {
          return;
        }

        if (
          currentSocket !== sock ||
          generation !== socketGeneration ||
          getConnectionState() !== "open"
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

          // Ignore group and broadcast messages.
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

          if (!body.trim()) {
            continue;
          }

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
      "[Connection] Connection initialization failed:",
      getDisconnectDetails(error)
    );

    if (!stopped) {
      scheduleReconnect();
    }

  } finally {
    connecting = false;
  }
}
