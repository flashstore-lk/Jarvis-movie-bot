
import makeWASocket, {
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore,
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

import {
  shouldProcessMessage,
  safeSendText
} from "./safety";

import {
  createAuthState,
  clearStoredAuthState
} from "./auth-store";

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

let linkAttemptActive = false;
let confirmationSent = false;

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

function isWhatsAppConnected(): boolean {
  return connectionState === "open";
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
    statusCode: err?.output?.statusCode ?? null
  };
}

// --------------------------------------------------
// STATUS
// --------------------------------------------------

export function getWhatsAppStatus() {
  const state = getConnectionState();

  return {
    connected: isWhatsAppConnected(),
    state,

    account: isWhatsAppConnected()
      ? currentSocket?.user?.id || null
      : null,

    hasQr: Boolean(latestQr),

    connecting:
      state === "connecting" ||
      state === "qr"
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
    await clearStoredAuthState();

    await mkdir(AUTH_DIR, {
      recursive: true
    });

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

      await unlink(
        path.join(AUTH_DIR, entry.name)
      );
    }

    console.log(
      "[Connection] Logged-out auth data cleared."
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

  linkAttemptActive = false;
  confirmationSent = false;

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
  const state = getConnectionState();

  if (connecting) return;

  if (
    currentSocket &&
    (
      state === "connecting" ||
      state === "qr" ||
      isWhatsAppConnected()
    )
  ) {
    return;
  }

  if (state === "logged_out") {
    await resetLoggedOutSession();
  }

  stopped = false;

  clearReconnectTimer();

  await connect();
}

// --------------------------------------------------
// WAIT FOR PAIRING SOCKET
// --------------------------------------------------

async function waitForPairingSocket(
  timeoutMs = PAIRING_READY_TIMEOUT
): Promise<WASocket> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = getConnectionState();

    if (stopped || state === "logged_out") {
      throw new Error(
        "WhatsApp session logged out."
      );
    }

    if (isWhatsAppConnected()) {
      throw new Error(
        "WhatsApp is already connected."
      );
    }

    if (state === "closed" && !connecting) {
      throw new Error(
        "WhatsApp connection closed."
      );
    }

    const sock = currentSocket;

    if (
      sock &&
      (
        state === "connecting" ||
        state === "qr"
      )
    ) {
      return sock;
    }

    if (!sock && !connecting) {
      await startWhatsApp();
    }

    await delay(250);
  }

  throw new Error(
    "WhatsApp pairing initialization timed out."
  );
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

  if (isWhatsAppConnected()) {
    throw new Error(
      "WhatsApp is already connected."
    );
  }

  pairingRequestInProgress = true;

  const previousLinkAttempt = linkAttemptActive;

  if (!linkAttemptActive) {
    confirmationSent = false;
  }

  linkAttemptActive = true;

  try {
    if (getConnectionState() === "logged_out") {
      await resetLoggedOutSession();
      linkAttemptActive = true;
    }

    const state = getConnectionState();

    if (
      !currentSocket ||
      state === "closed" ||
      state === "idle"
    ) {
      await startWhatsApp();
    }

    const sock = await waitForPairingSocket();

    await delay(PAIRING_SETTLE_DELAY);

    if (
      currentSocket !== sock ||
      stopped ||
      getConnectionState() === "closed" ||
      getConnectionState() === "logged_out"
    ) {
      throw new Error(
        "WhatsApp connection changed before pairing."
      );
    }

    if (isWhatsAppConnected()) {
      throw new Error(
        "WhatsApp is already connected."
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
      "[Connection] Pairing code generated."
    );

    return code;

  } catch (error) {
    if (!isWhatsAppConnected()) {
      linkAttemptActive = previousLinkAttempt;
    }

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
  if (connecting || stopped) return;

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
    } = await createAuthState();

    console.log(
      "[Connection] Auth state loaded."
    );

    console.log(
      "[Connection] Fetching WhatsApp Web version..."
    );

    const versionResult =
      await fetchLatestWaWebVersion({
        timeout: 15000
      });

    if (!versionResult.isLatest) {
      console.warn(
        "[Connection] Latest version unavailable. Using returned version."
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

    const logger = pino({
      level: "silent"
    });

    const auth = {
      creds: state.creds,

      keys: makeCacheableSignalKeyStore(
        state.keys,
        logger
      )
    };

    // KIRA-MD style browser identity.
    const sock = makeWASocket({
      version,

      auth,

      logger,

      printQRInTerminal: false,

      browser: Browsers.windows("Chrome"),

      markOnlineOnConnect: false,

      keepAliveIntervalMs: 30000,

      connectTimeoutMs: 60000,

      defaultQueryTimeoutMs: 60000
    });

    currentSocket = sock;

    connectionState = "connecting";
    latestQr = null;

    // ------------------------------------------------
    // SAVE CREDENTIALS
    // ------------------------------------------------

    sock.ev.on(
      "creds.update",
      () => {
        void saveCreds().catch(error => {
          console.error(
            "[Connection] Credential persistence failed:",
            getDisconnectDetails(error)
          );
        });
      }
    );

    // ------------------------------------------------
    // CONNECTION EVENTS
    // ------------------------------------------------

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
          if (!linkAttemptActive) {
            confirmationSent = false;
          }

          linkAttemptActive = true;

          latestQr = qr;

          if (!isWhatsAppConnected()) {
            connectionState = "qr";
          }

          console.log(
            "[Connection] QR event received."
          );
        }

        // --------------------------------------------
        // SUCCESSFUL CONNECTION
        // --------------------------------------------

        if (connection === "open") {
          connectionState = "open";

          latestQr = null;

          reconnectDelay = 2000;
          stopped = false;

          clearReconnectTimer();

          console.log(
            "[Connection] WhatsApp connected successfully."
          );

          if (
            linkAttemptActive &&
            !confirmationSent &&
            sock.user?.id
          ) {
            const ownJid = sock.user.id;

            confirmationSent = true;
            linkAttemptActive = false;

            void safeSendText(
              sock,
              ownJid,
              "J.A.R.V.I.S. WhatsApp linked successfully."
            ).catch(error => {
              console.error(
                "[Connection] Confirmation message failed:",
                getDisconnectDetails(error)
              );
            });
          }
        }

        // --------------------------------------------
        // CONNECTION CLOSED
        // --------------------------------------------

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

            linkAttemptActive = false;
            confirmationSent = false;

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

    // ------------------------------------------------
    // INCOMING MESSAGES
    // ------------------------------------------------

    sock.ev.on(
      "messages.upsert",
      async ({ messages, type }) => {
        if (type !== "notify") return;

        if (
          currentSocket !== sock ||
          generation !== socketGeneration ||
          !isWhatsAppConnected()
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

          // Private chats only.
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
    if (generation === socketGeneration) {
      connectionState = "closed";
      latestQr = null;
    }

    console.error(
      "[Connection] Initialization failed:",
      getDisconnectDetails(error)
    );

    if (
      !stopped &&
      generation === socketGeneration
    ) {
      scheduleReconnect();
    }

  } finally {
    connecting = false;
  }
}
