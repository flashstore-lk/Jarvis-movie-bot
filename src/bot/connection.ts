
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type WASocket
} from "@whiskeysockets/baileys";

import pino from "pino";
import qrcode from "qrcode-terminal";

import { env } from "../config/env";
import { handleMessage } from "./commands";

let currentSocket: WASocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

let reconnectDelay = 2000;
let stopped = false;

export function getWhatsAppStatus() {
  return {
    connected: Boolean(currentSocket?.user),
    account: currentSocket?.user?.id || null
  };
}

export async function startWhatsApp() {
  stopped = false;
  await connect();
}

async function connect() {
  const { state, saveCreds } =
    await useMultiFileAuthState(env.authDir);

  const { version } =
    await fetchLatestBaileysVersion();

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
        return;
      }

      if (!stopped && !reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;

          void connect().catch(error => {
            console.error(
              "Reconnect failed:",
              error
            );
          });
        }, reconnectDelay);

        reconnectDelay = Math.min(
          reconnectDelay * 2,
          60000
        );
      }
    }
  });

  sock.ev.on(
    "messages.upsert",
    async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        if (
          !msg.message ||
          msg.key.fromMe ||
          !msg.key.remoteJid
        ) {
          continue;
        }

        const jid = msg.key.remoteJid;

        // Private chats only
        if (jid.endsWith("@g.us")) continue;

        const body =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          "";

        try {
          await handleMessage(
            sock,
            jid,
            body
          );
        } catch (error) {
          console.error(
            "Message handler failed:",
            error
          );

          await sock.sendMessage(jid, {
            text:
              "දෝෂයක් ඇතිවුණා. නැවත උත්සාහ කරන්න."
          });
        }
      }
    }
  );
}
