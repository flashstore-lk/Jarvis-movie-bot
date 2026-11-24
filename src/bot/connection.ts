
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

  const code = await sock.requestPairingCode(
    cleanNumber
  );

  return code;
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

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    if (stopped || currentSocket || connecting) {
      return;
    }

    try {
      await connect();
    } catch (error) {
      console.error("WhatsApp reconnect failed:", error);
      scheduleReconnect();
    }
  }, reconnectDelay);

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

      // Keep QR in memory for the authenticated website API.
      // Never print the actual QR value in Railway logs.
      if (qr) {
        latestQr = qr;

        console.log(
          "A new WhatsApp QR is available for the pairing website."
        );
      }

      if (connection === "connecting") {
        console.log("WhatsApp connection is starting...");
      }

      if (connection === "open") {
        latestQr = null;
        reconnectDelay = 2000;

        clearReconnectTimer();

        console.log("WhatsApp connected successfully.");
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
            "WhatsApp logged out. Please link the account again."
          );

          stopped = true;
          clearReconnectTimer();
          return;
        }

        console.log(
          "WhatsApp disconnected. Reconnection will be attempted."
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

          // Ignore group conversations.
          if (jid.endsWith("@g.us")) {
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
            console.error(
              "Message handler failed:",
              error
            );

            try {
              await sock.sendMessage(jid, {
                text:
                  "දෝෂයක් ඇතිවුණා. නැවත උත්සාහ කරන්න."
              });

            } catch (sendError) {
              console.error(
                "Error reply failed:",
                sendError
              );
            }
          }
        }
      }
    );

  } catch (error) {
    console.error(
      "WhatsApp connection failed:",
      error
    );

    if (!stopped) {
      scheduleReconnect();
    }

  } finally {
    connecting = false;
  }
}
