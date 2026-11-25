
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type WASocket
} from "@whiskeysockets/baileys";

import pino from "pino";
import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env";
import { handleMessage } from "./commands";
import { shouldProcessMessage } from "./safety";

type ConnectionState =
  | "idle"
  | "connecting"
  | "qr"
  | "open"
  | "closed"
  | "logged_out";

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

const PAIRING_READY_TIMEOUT = 45000;
const PAIRING_SETTLE_DELAY = 5000;

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
// CLEAR LOGGED-OUT AUTH FILES
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
      if (!entry.isFile()) {
        continue;
      }

      if (
        entry.name === "jarvis-safety.json" ||
        entry.name === "jarvis-safety.json.tmp"
      ) {
        continue;
      }

      await unlink(path.join(AUTH_DIR, entry.name));
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
    stopped = true;
    clearReconnectTimer();

    await clearLoggedOutAuthFiles();

    currentSocket = null;
    latestQr = null;
    connectionState = "idle";
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

  if (connectionState === "open") {
    throw new Error(
      "WhatsApp is already connected."
    );
  }

  pairingRequestInProgress = true;

  try {
    if (connectionState === "logged_out") {
      stopped = true;
      clearReconnectTimer();

      await clearLoggedOutAuthFiles();

      currentSocket = null;
      latestQr = null;
      connectionState = "idle";
      stopped = false;
    }

    if (
      !currentSocket ||
      connectionState === "closed" ||
      connectionState === "idle"
    ) {
      await startWhatsApp();
    }

    // Wait until Baileys has produced a QR event.
    const sock = await waitForPairingReady();

    // Allow the WebSocket transport to settle.
    await delay(PAIRING_SETTLE_DELAY);

    // Read the latest state through a function.
    // This avoids TypeScript's stale control-flow narrowing.
    const latestState = getConnectionState();

    if (
      currentSocket !== sock ||
      latestState === "closed" ||
      latestState === "logged_out" ||
      latestState === "open"
    ) {
      throw new Error(
        "WhatsApp connection changed before the pairing request. Please try again."
      );
    }

    console.log(
      "[Connection] Requesting WhatsApp pairing code..."
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
      "[Connection] Pairing request failed:",
      error instanceof Error ? error.message : error
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
      throw new Error(
        "WhatsApp session logged out. Please retry."
      );
    }

    if (connectionState === "open") {
      throw new Error(
        "WhatsApp is already connected."
      );
    }

    if (
      connectionState === "closed" &&
      !connecting
    ) {
      throw new Error(
        "WhatsApp connection closed before pairing was ready. Please retry."
      );
    }

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
    "WhatsApp is taking too long to connect. Please wait and try again."
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
    `[Connection] Reconnecting in ${Math.round(waitTime / 1000)} seconds...`
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
        error
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
    await mkdir(AUTH_DIR, { recursive: true });

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

    sock.ev.on("creds.update", saveCreds);

    // --------------------------------------------------
    // CONNECTION EVENTS
    // --------------------------------------------------

    sock.ev.on("connection.update", update => {
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
          "[Connection] WhatsApp connection is starting..."
        );
      }

      if (qr) {
        latestQr = qr;

        if (connectionState !== "open") {
          connectionState = "qr";
        }

        console.log(
          "[Connection] QR is ready."
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
        const statusCode =
          (lastDisconnect?.error as any)
            ?.output?.statusCode;

        latestQr = null;

        if (currentSocket === sock) {
          currentSocket = null;
        }

        if (
          statusCode === DisconnectReason.loggedOut
        ) {
          connectionState = "logged_out";
          stopped = true;

          clearReconnectTimer();

          // Invalidate all events from this socket.
          socketGeneration += 1;

          console.error(
            "[Connection] WhatsApp logged out. Clearing old auth session."
          );

          void clearLoggedOutAuthFiles().catch(error => {
            console.error(
              "[Connection] Auth cleanup failed:",
              error
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
    });

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

          // Ignore groups and broadcast messages.
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
              error
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
      error
    );

    if (!stopped) {
      scheduleReconnect();
    }

  } finally {
    connecting = false;
  }
}
