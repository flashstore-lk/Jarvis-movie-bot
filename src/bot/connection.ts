
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

type ConnectionState =
  | "idle"
  | "connecting"
  | "qr"
  | "open"
  | "closed"
  | "logged_out";

let currentSocket: WASocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

let reconnectDelay = 2000;
let stopped = false;
let connecting = false;
let pairingRequestInProgress = false;

let latestQr: string | null = null;
let connectionState: ConnectionState = "idle";

let socketGeneration = 0;
let authCleanupPromise: Promise<void> | null = null;

const AUTH_DIR = env.authDir || "/app/auth_info";

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
// Preserve jarvis-safety.json.
// Only used after WhatsApp reports loggedOut.
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
      { withFileTypes: true }
    );

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      // Never delete opt-out / safety records.
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
      "[Connection] Logged-out WhatsApp auth files cleared. Safety data preserved."
    );
  })();

  try {
    await authCleanupPromise;
  } finally {
    authCleanupPromise = null;
  }
}

// --------------------------------------------------
// START
// --------------------------------------------------

export async function startWhatsApp(): Promise<void> {
  stopped = false;

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
    await clearLoggedOutAuthFiles();
    connectionState = "idle";
  }

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
      "WhatsApp is already connected. Disconnect the linked device first if you want to change accounts."
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

    const sock = await waitForPairingSocket();

    if (connectionState === "open" || sock.user) {
      throw new Error(
        "WhatsApp is already connected."
      );
    }

    const code = await sock.requestPairingCode(
      cleanNumber
    );

    console.log(
      "[Connection] Pairing code generated successfully."
    );

    return code;

  } finally {
    pairingRequestInProgress = false;
  }
}

// --------------------------------------------------
// WAIT FOR SOCKET
// --------------------------------------------------

async function waitForPairingSocket(
  timeoutMs = 30000
): Promise<WASocket> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (stopped || connectionState === "logged_out") {
      throw new Error(
        "WhatsApp session was logged out. Please retry the pairing process."
      );
    }

    if (connectionState === "open") {
      throw new Error(
        "WhatsApp is already connected."
      );
    }

    if (
      currentSocket &&
      (
        connectionState === "connecting" ||
        connectionState === "qr"
      )
    ) {
      return currentSocket;
    }

    if (!connecting && !currentSocket) {
      await startWhatsApp();
    }

    await new Promise(resolve =>
      setTimeout(resolve, 250)
    );
  }

  throw new Error(
    "WhatsApp connection is not ready. Please wait and try again."
  );
}

// --------------------------------------------------
// RECONNECT MANAGEMENT
// --------------------------------------------------

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (
    stopped ||
    reconnectTimer ||
    connectionState === "logged_out"
  ) {
    return;
  }

  const scheduledDelay = reconnectDelay;

  console.log(
    `[Connection] Reconnect scheduled in ${Math.round(
      scheduledDelay / 1000
    )} seconds.`
  );

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    if (
      stopped ||
      currentSocket ||
      connecting ||
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
  }, scheduledDelay);

  reconnectDelay = Math.min(
    reconnectDelay * 2,
    60000
  );
}

// --------------------------------------------------
// CONNECTION
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

    const {
      version
    } = await fetchLatestBaileysVersion();

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

      markOnlineOnConnect: false
    });

    currentSocket = sock;
    connectionState = "connecting";

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

      if (qr) {
        latestQr = qr;

        if (connectionState !== "open") {
          connectionState = "qr";
        }

        console.log(
          "[Connection] A new QR is available on the pairing website."
        );
      }

      if (connection === "connecting") {
        connectionState = "connecting";

        console.log(
          "[Connection] WhatsApp connection is starting..."
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

          // Invalidate events from this socket.
          socketGeneration += 1;

          console.error(
            "[Connection] WhatsApp logged out. Old auth session will be cleared."
          );

          void clearLoggedOutAuthFiles().catch(error => {
            console.error(
              "[Connection] Could not clear logged-out auth files:",
              error
            );
          });

          return;
        }

        connectionState = "closed";

        console.log(
          "[Connection] WhatsApp disconnected. Reconnection will be attempted."
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

          // Ignore groups, status and broadcast messages.
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

    console.error(
      "[Connection] WhatsApp connection failed:",
      error
    );

    if (!stopped) {
      scheduleReconnect();
    }

  } finally {
    connecting = false;
  }
}
