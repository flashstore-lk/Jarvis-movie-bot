
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type WASocket
} from "@whiskeysockets/baileys";

import pino from "pino";
import qrcode from "qrcode-terminal";
import { mkdir } from "node:fs/promises";

import { env } from "../config/env";
import { handleMessage } from "./commands";

let currentSocket: WASocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

let reconnectDelay = 2000;
let stopped = false;
let connecting = false;

const AUTH_DIR = env.authDir || "/app/auth_info";

export function getWhatsAppStatus() {
  return {
    connected: Boolean(currentSocket?.user),
    account: currentSocket?.user?.id || null
  };
}

export async function startWhatsApp() {
  stopped = false;

  if (currentSocket || connecting) return;

  await connect();
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    if (stopped || currentSocket || connecting) return;

    try {
      await connect();
    } catch (error) {
      console.error("Reconnect failed:", error);
      scheduleReconnect();
    }
  }, reconnectDelay);

  reconnectDelay = Math.min(
    reconnectDelay * 2,
    60000
  );
}

async function connect() {
  if (connecting || stopped) return;

  connecting = true;

  try {
    // Ensure Railway Volume directory exists.
    await mkdir(AUTH_DIR, { recursive: true });

    const { state, saveCreds } =
      await useMultiFileAuthState(AUTH_DIR);

    const { version } =
      await fetchLatestBaileysVersion();

    if (stopped) return;

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: "silent" }),
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
      if (currentSocket !== sock) return;

      const {
        connection,
        lastDisconnect,
        qr
      } = update;

      if (qr) {
        console.log("Scan this WhatsApp QR:");

        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        reconnectDelay = 2000;

        console.log("WhatsApp connected.");
      }

      if (connection === "close") {
        currentSocket = null;

        const statusCode =
          (lastDisconnect?.error as any)
            ?.output?.statusCode;

        if (
          statusCode === DisconnectReason.loggedOut
        ) {
          console.error(
            "WhatsApp logged out. Please link again."
          );

          stopped = true;
          return;
        }

        console.log(
          "WhatsApp disconnected. Reconnecting..."
        );

        scheduleReconnect();
      }
    });

    sock.ev.on(
      "messages.upsert",
      async ({ messages, type }) => {
        if (type !== "notify") return;
        if (currentSocket !== sock) return;

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
          if (jid.endsWith("@g.us")) continue;

          const body =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";

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
    console.error("WhatsApp connection failed:", error);

    scheduleReconnect();
  } finally {
    connecting = false;
  }
}
