import type { WASocket } from "@whiskeysockets/baileys";
import { env } from "../config/env";
import {
  addAdmin, adminCan, getBotSetting, isOwner, removeAdmin, setBotSetting
} from "../database/supabase";
import { safeSendText } from "./safety";

function cleanJid(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  if (!/^\d{8,15}$/.test(digits)) return null;
  return `${digits}@s.whatsapp.net`;
}

export async function handleSettings(sock: WASocket, jid: string, args: string) {
  if (!await adminCan(jid, "settings:welcome") && !await isOwner(jid)) {
    await safeSendText(sock, jid, "🔒 මෙම Command එක භාවිතා කිරීමට Owner/Admin අවසර අවශ්‍යයි.");
    return true;
  }
  const [action = "", ...rest] = args.trim().split(/\s+/);
  const value = rest.join(" ").trim();

  if (!action || action === "help") {
    const welcome = await getBotSetting("welcome_message");
    const maintenance = (await getBotSetting("maintenance")) === "on";
    await safeSendText(sock, jid, [
      "╭─「 J.A.R.V.I.S. SETTINGS 」",
      "│",
      `│ Welcome: ${welcome ? "Customized" : "Default"}`,
      `│ Maintenance: ${maintenance ? "ON" : "OFF"}`,
      "│",
      "│ .settings welcome <message>",
      "│ .settings welcome reset",
      "│ .settings maintenance on/off (Owner)",
      "│ .settings admin add <number> (Owner)",
      "│ .settings admin remove <number> (Owner)",
      "│",
      "╰──────────────●●►"
    ].join("\n"));
    return true;
  }

  if (action === "welcome") {
    if (!await adminCan(jid, "settings:welcome")) {
      await safeSendText(sock, jid, "🔒 Welcome Message වෙනස් කිරීමට අවසර නැහැ.");
      return true;
    }
    if (!value) {
      await safeSendText(sock, jid, "භාවිතය: `.settings welcome <message>`");
      return true;
    }
    await setBotSetting("welcome_message", value.toLowerCase() === "reset" ? "" : value.slice(0, 500), jid);
    await safeSendText(sock, jid, value.toLowerCase() === "reset" ? "Welcome Message default තත්ත්වයට reset කළා." : "Welcome Message update කළා.");
    return true;
  }

  if (action === "maintenance") {
    if (!await isOwner(jid)) {
      await safeSendText(sock, jid, "🔒 Maintenance Mode වෙනස් කළ හැක්කේ Ownerට පමණයි.");
      return true;
    }
    const mode = value.toLowerCase();
    if (!["on", "off"].includes(mode)) {
      await safeSendText(sock, jid, "භාවිතය: `.settings maintenance on` හෝ `.settings maintenance off`");
      return true;
    }
    await setBotSetting("maintenance", mode, jid);
    await safeSendText(sock, jid, `Maintenance Mode: ${mode.toUpperCase()}`);
    return true;
  }

  if (action === "admin") {
    if (!await isOwner(jid)) {
      await safeSendText(sock, jid, "🔒 Adminලා එකතු කිරීම/ඉවත් කිරීම Ownerට පමණයි.");
      return true;
    }
    const [operation, number] = value.split(/\s+/);
    const target = number ? cleanJid(number) : null;
    if (!target || !["add", "remove"].includes((operation || "").toLowerCase())) {
      await safeSendText(sock, jid, "භාවිතය:\n`.settings admin add 947XXXXXXXX`\n`.settings admin remove 947XXXXXXXX`");
      return true;
    }
    if (env.ownerJid && target === env.ownerJid) {
      await safeSendText(sock, jid, "Owner account එක Admin ලෙස වෙනස් කළ නොහැක.");
      return true;
    }
    if (operation.toLowerCase() === "add") {
      await addAdmin(target, jid);
      await safeSendText(sock, jid, `✅ Admin එකතු කළා: ${target}\nDefault permission: Welcome Message වෙනස් කිරීම.`);
    } else {
      await removeAdmin(target);
      await safeSendText(sock, jid, `✅ Admin අවසර ඉවත් කළා: ${target}`);
    }
    return true;
  }

  await safeSendText(sock, jid, "Settings command එක හඳුනාගන්න බැහැ. `.settings help` යවන්න.");
  return true;
}
