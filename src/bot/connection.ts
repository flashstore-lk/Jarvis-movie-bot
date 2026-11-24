import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type WASocket
} from "@whiskeysockets/baileys";

import pino from "pino";
import { mkdir } from "node:fs/promises";

import { env } from "../config/env";
import { handleMessage } from "./commands";

import {
  safeSendText,
  shouldProcessMessage
} from "./safety";

let currentSocket: WASocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

let reconnectDelay = 2000;
let stopped = false;
let connecting = false;
let latestQr: string | null = null;
let socketGeneration = 0;

const AUTH_DIR = env.authDir || "/app/auth_info";

export function getWhatsAppStatus() {
  return {
    connected: Boolean(currentSocket?.user),
    account: currentSocket?.user?.id || null,
    hasQr: Boolean(latestQr),
    connecting
  };
}

export function getLatestQr(): string | null {
  return latestQr;
}

export async function startWhatsApp(): Promise<void> {
  stopped = false;

  if (currentSocket || connecting) {
    return;
  }

  await connect();
}

export async function requestWhatsAppPairingCode(
  phoneNumber: string
): Promise<string> {
  const cleanNumber = phoneNumber.replace(/\D/g, "");

  if (!/^\d{8,15}$/.test(cleanNumber)) {
    throw new Error(
      "Enter a valid phone number with country code."
    );
  }

  if (currentSocket?.user) {
    throw new Error("WhatsApp is already connected.");
  }

  await startWhatsApp();

  const sock = await waitForSocket();

  if (sock.user) {
    throw new Error("WhatsApp is already connected.");
  }

  return sock.requestPairingCode(cleanNumber);
}

async function waitForSocket(
  timeoutMs = 20000
): Promise<WASocket> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (stopped) {
      throw new Error("WhatsApp connection was stopped.");
    }

    if (currentSocket?.user) {
      return currentSocket;
    }

    if (currentSocket && latestQr) {
      return currentSocket;
    }

    await new Promise(resolve =>
      setTimeout(resolve, 200)
    );
  }

  throw new Error(
    "WhatsApp connection is not ready. Please try again."
  );
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) {
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

    if (stopped || currentSocket || connecting) {
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

async function connect(): Promise<void> {
  if (connecting || stopped) {
    return;
  }

  connecting = true;

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

    if (stopped || generation !== socketGeneration) {
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

    sock.ev.on("creds.update", saveCreds);

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

      // QR stays in memory for the protected pairing API.
      // Never print the QR contents in logs.
      if (qr) {
        latestQr = qr;

        console.log(
          "[Connection] A new QR is available on the pairing website."
        );
      }

      if (connection === "connecting") {
        console.log(
          "[Connection] WhatsApp connection is starting..."
        );
      }

      if (connection === "open") {
        latestQr = null;
        reconnectDelay = 2000;

        clearReconnectTimer();

        console.log(
          "[Connection] WhatsApp connected successfully."
        );
      }

      if (connection === "close") {
        if (currentSocket === sock) {
          currentSocket = null;
        }

        latestQr = null;

        const statusCode =
          (lastDisconnect?.error as any)
            ?.output?.statusCode;

        if (
          statusCode === DisconnectReason.loggedOut
        ) {
          console.error(
            "[Connection] WhatsApp logged out. Link the account again."
          );

          stopped = true;
          clearReconnectTimer();
          return;
        }

        console.log(
          "[Connection] WhatsApp disconnected."
        );

        scheduleReconnect();
      }
    });

    sock.ev.on(
      "messages.upsert",
      async ({ messages, type }) => {
        if (type !== "notify") {
          return;
        }

        if (
          currentSocket !== sock ||
          generation !== socketGeneration
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

          // Ignore group, status and broadcast messages.
          if (
            jid.endsWith("@g.us") ||
            jid.endsWith("@broadcast") ||
            jid === "status@broadcast"
          ) {
            continue;
          }

          // Ignore duplicate WhatsApp message IDs.
          if (
            !shouldProcessMessage(jid, msg.key.id)
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
            await handleMessage(sock, jid, body);

          } catch (error) {
            // Do not send an automatic error reply here.
            // This avoids extra replies when safety storage or
            // the outgoing queue is unavailable.
            console.error(
              "[Bot] Message processing failed:",
              error
            );
          }
        }
      }
    );

  } catch (error) {
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
