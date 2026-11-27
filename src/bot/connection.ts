
import makeWASocket, {
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestWaWebVersion,
  type WASocket,
  type WAMessageKey
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
import { getBotSetting } from "../database/supabase";

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

// Processing reaction settings
const PROCESSING_REACTION = "⏳";
const PROCESSING_DELAY = 1000;

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
  const err = error as {
    name?: string;
    message?: string;
    output?: {
      statusCode?: number;
    };
  } | null;

  return {
    name: err?.name || "UnknownError",
    message: err?.message || String(error),
    statusCode: err?.output?.statusCode ?? null
  };
}

// --------------------------------------------------
// MESSAGE REACTION
// --------------------------------------------------

async function addProcessingReaction(
  sock: WASocket,
  jid: string,
  messageKey: WAMessageKey
): Promise<boolean> {
  try {
    await sock.sendMessage(jid, {
      react: {
        text: PROCESSING_REACTION,
        key: messageKey
      }
    });

    return true;
  } catch (error) {
    console.warn(
      "[Reaction] Could not add processing reaction:",
      getDisconnectDetails(error)
    );

    return false;
  }
}

async function removeProcessingReaction(
  sock: WASocket,
  jid: string,
  messageKey: WAMessageKey
): Promise<void> {
  try {
    await sock.sendMessage(jid, {
      react: {
        text: "",
        key: messageKey
      }
    });
  } catch (error) {
    console.warn(
      "[Reaction] Could not remove processing reaction:",
      getDisconnectDetails(error)
    );
  }
}

// --------------------------------------------------
// MESSAGE DIAGNOSTICS
// --------------------------------------------------

function getMessageType(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "none";
  }

  return Object.keys(message).join(",");
}

function getJidType(jid: string): string {
  return jid.split("@").pop() || "unknown";
}


function normalizeComparableJid(value: string | null | undefined): string {
  if (!value) return "";
  const clean = value.trim().toLowerCase().replace(/:\d+(?=@)/, "");
  if (!clean) return "";
  if (clean.includes("@")) return clean;
  if (/^\d{8,16}$/.test(clean)) return `${clean}@s.whatsapp.net`;
  return clean;
}

function sameAccountJid(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizeComparableJid(left);
  const b = normalizeComparableJid(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const aPhone = a.endsWith("@s.whatsapp.net") ? a.split("@")[0] : "";
  const bPhone = b.endsWith("@s.whatsapp.net") ? b.split("@")[0] : "";
  return Boolean(aPhone && bPhone && aPhone === bPhone);
}

function isOwnAccountChat(sock: WASocket, messageKey: WAMessageKey): boolean {
  const extendedKey = messageKey as WAMessageKey & {
    remoteJidAlt?: string;
    participantAlt?: string;
  };
  const user = sock.user as (typeof sock.user & { lid?: string }) | undefined;
  const ownIds = [user?.id, user?.lid].filter((value): value is string => Boolean(value));
  const chatIds = [messageKey.remoteJid, extendedKey.remoteJidAlt]
    .filter((value): value is string => Boolean(value));
  return ownIds.some((ownId) => chatIds.some((chatId) => sameAccountJid(ownId, chatId)));
}

function chooseSenderJid(primary?: string | null, alternate?: string | null): string {
  const candidates = [primary, alternate].filter((value): value is string => Boolean(value));
  return candidates.find((value) => normalizeComparableJid(value).endsWith("@s.whatsapp.net"))
    || candidates[0]
    || "";
}

function getCommandLabel(body: string): string {
  const trimmed = body.trim();

  if (!trimmed.startsWith(".")) {
    return "plain-text";
  }

  return trimmed.split(/\s+/)[0].slice(0, 20);
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

    // ----------------------------------------------
    // SAVE CREDENTIALS
    // ----------------------------------------------

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

    // ----------------------------------------------
    // CONNECTION EVENTS
    // ----------------------------------------------

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

        // ------------------------------------------
        // SUCCESSFUL CONNECTION
        // ------------------------------------------

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

        // ------------------------------------------
        // CONNECTION CLOSED
        // ------------------------------------------

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

    // ----------------------------------------------
    // INCOMING MESSAGES
    // ----------------------------------------------

    sock.ev.on(
      "messages.upsert",
      async ({ messages, type }) => {
        if (
          currentSocket !== sock ||
          generation !== socketGeneration ||
          !isWhatsAppConnected()
        ) {
          return;
        }

        console.log(
          `[Messages] Upsert received: type=${type}, count=${messages.length}`
        );

        if (type !== "notify") {
          console.log(
            `[Messages] Ignored event type: ${type}`
          );

          return;
        }

        for (const msg of messages) {
          const jid = msg.key.remoteJid;
          const fromMe = Boolean(msg.key.fromMe);

          const messageTypes = getMessageType(
            msg.message
          );

          const jidType = jid
            ? getJidType(jid)
            : "unknown";

          console.log(
            `[Messages] Item: fromMe=${fromMe}, jidType=${jidType}, messageTypes=${messageTypes}`
          );

          if (!msg.message || !jid) {
            console.log(
              "[Messages] Ignored: missing message or JID."
            );

            continue;
          }

          const extendedKey = msg.key as WAMessageKey & {
            remoteJidAlt?: string;
            participantAlt?: string;
          };
          const isGroup = jid.endsWith("@g.us");
          const isBroadcast = jid.endsWith("@broadcast") || jid === "status@broadcast";
          const ownChat = isOwnAccountChat(sock, msg.key);
          const body =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";
          const trimmedBody = body.trim();
          const chatMode = (await getBotSetting("chat_mode") || "public").toLowerCase();

          if (isBroadcast) {
            console.log("[Messages] Ignored: broadcast/status message.");
            continue;
          }

          let senderJid = "";
          if (isGroup) {
            if (fromMe) {
              console.log("[Messages] Ignored outgoing group message.");
              continue;
            }
            if (chatMode !== "group") {
              console.log(`[Messages] Ignored group message in ${chatMode} mode.`);
              continue;
            }
            senderJid = chooseSenderJid(msg.key.participant, extendedKey.participantAlt);
            if (!senderJid) {
              console.log("[Messages] Ignored group message without participant identity.");
              continue;
            }
          } else {
            // Messages sent by the linked account are accepted only in its own Self-Chat.
            if (fromMe && !ownChat) {
              console.log("[Messages] Ignored outgoing message outside Self-Chat.");
              continue;
            }

            if (chatMode === "private" && !ownChat) {
              console.log("[Messages] Ignored message: private mode allows Self-Chat only.");
              continue;
            }

            // In group mode, allow the Owner to switch modes from the linked account's Self-Chat.
            const ownerControlInGroupMode =
              chatMode === "group" &&
              ownChat &&
              /^\.settings(?:\\s|$)/i.test(trimmedBody);

            if (chatMode === "group" && !ownerControlInGroupMode) {
              console.log("[Messages] Ignored private message in group mode.");
              continue;
            }

            senderJid = ownChat
              ? sock.user?.id || jid
              : chooseSenderJid(msg.key.participant, extendedKey.participantAlt) || jid;
          }

          if (!trimmedBody) {
            console.warn("[Messages] Ignored: no supported text body.");
            continue;
          }

          if (
            !shouldProcessMessage(
              jid,
              msg.key.id
            )
          ) {
            console.log(
              "[Messages] Ignored: duplicate message."
            );

            continue;
          }

          // ----------------------------------------
          // EXTRACT QUOTED MESSAGE ID
          // ----------------------------------------

          // Fix: Convert null to undefined.
          const quotedMessageId =
            msg.message.extendedTextMessage
              ?.contextInfo?.stanzaId ?? undefined;

          const commandLabel =
            getCommandLabel(trimmedBody);

          console.log(
            `[Messages] Processing: type=${commandLabel}, length=${trimmedBody.length}, isReply=${Boolean(quotedMessageId)}`
          );

          // ----------------------------------------
          // ADD PROCESSING REACTION
          // ----------------------------------------

          const autoReactEnabled =
            (await getBotSetting("auto_react") || "on").toLowerCase() === "on";
          const reactionAdded = autoReactEnabled
            ? await addProcessingReaction(sock, jid, msg.key)
            : false;

          try {
            // Wait approximately one second.
            await delay(PROCESSING_DELAY);

            // Process the incoming message.
            await handleMessage(
              sock,
              jid,
              body,
              quotedMessageId,
              senderJid
            );

            console.log(
              "[Messages] Processing completed successfully."
            );
          } catch (error) {
            console.error(
              "[Bot] Message processing failed:",
              getDisconnectDetails(error)
            );

            try {
              await safeSendText(
                sock,
                jid,
                "Bot එකේ message එක process කිරීමේදී දෝෂයක් ඇතිවුණා. නැවත උත්සාහ කරන්න."
              );
            } catch (sendError) {
              console.error(
                "[Bot] Error notification failed:",
                getDisconnectDetails(sendError)
              );
            }
          } finally {
            // Remove reaction after processing finishes.
            if (reactionAdded) {
              await removeProcessingReaction(
                sock,
                jid,
                msg.key
              );
            }

            console.log(
              "[Messages] Processing reaction cleanup completed."
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
