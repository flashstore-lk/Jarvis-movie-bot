import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { handleText } from './commands.js';

export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['Movie Assistant', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe || !msg.key.remoteJid) continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue; // private chats only
      const text = msg.message.conversation
        ?? msg.message.extendedTextMessage?.text
        ?? '';
      if (text) await handleText(sock, msg.key.remoteJid, text);
    }
  });

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log('WhatsApp disconnected; restart the process to reconnect.');
      } else {
        console.error('WhatsApp session logged out. Remove old auth_info only if you intend to pair again.');
      }
    }
    if (connection === 'open') console.log('WhatsApp connected.');
  });
  return sock;
}
