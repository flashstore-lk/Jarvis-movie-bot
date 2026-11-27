import type { WASocket } from "@whiskeysockets/baileys";
import { env } from "../config/env";
import {
  addAdmin, adminCan, getBotSetting, getBotSettings, isOwner, listAdmins,
  removeAdmin, setAdminPermissions, setBotSetting
} from "../database/supabase";
import { safeSendText } from "./safety";

type SettingDef = {
  id: number; category: string; label: string; key: string; value: string;
  options?: string[]; ownerOnly?: boolean; editable?: boolean;
};

const settings: SettingDef[] = [
  {id:1,category:"Chat & Message",label:"𝙲𝚑𝚊𝚝 𝙼𝚘𝚍𝚎",key:"chat_mode",value:"public",options:["public","private","group"],ownerOnly:true},
  {id:2,category:"Chat & Message",label:"𝙿𝚛𝚎𝚏𝚒𝚡",key:"prefix",value:".",options:["on","off","edit"]},
  {id:3,category:"Chat & Message",label:"𝙰𝚞𝚝𝚘 𝚁𝚎𝚊𝚍",key:"auto_read",value:"off",options:["on","off"]},
  {id:4,category:"Chat & Message",label:"𝙰𝚞𝚝𝚘 𝚃𝚢𝚙𝚒𝚗𝚐",key:"auto_typing",value:"on",options:["on","off"]},
  {id:5,category:"Chat & Message",label:"𝙰𝚞𝚝𝚘 𝚁𝚎𝚌𝚘𝚛𝚍𝚒𝚗𝚐",key:"auto_recording",value:"off",options:["on","off"]},
  {id:6,category:"Chat & Message",label:"𝙰𝚞𝚝𝚘 𝚁𝚎𝚊𝚌𝚝",key:"auto_react",value:"on",options:["on","off"]},
  {id:7,category:"Chat & Message",label:"𝙰𝚞𝚝𝚘 𝚂𝚎𝚎𝚗",key:"auto_seen",value:"off",options:["on","off"]},
  {id:8,category:"Chat & Message",label:"𝚆𝚎𝚕𝚌𝚘𝚖𝚎 𝙼𝚎𝚜𝚜𝚊𝚐𝚎",key:"welcome_message",value:"default",options:["on","off","edit","reset"]},
  {id:9,category:"Chat & Message",label:"𝙶𝚘𝚘𝚍𝚋𝚢𝚎 𝙼𝚎𝚜𝚜𝚊𝚐𝚎",key:"goodbye_message",value:"off",options:["on","off","edit","reset"]},
  {id:10,category:"Chat & Message",label:"𝙰𝚞𝚝𝚘 𝚁𝚎𝚙𝚕𝚢",key:"auto_reply",value:"off",options:["on","off","edit"]},
  {id:11,category:"Chat & Message",label:"𝙼𝚎𝚜𝚜𝚊𝚐𝚎 𝙳𝚎𝚕𝚊𝚢",key:"message_delay",value:"0s",editable:true},
  {id:12,category:"Chat & Message",label:"𝙻𝚊𝚗𝚐𝚞𝚊𝚐𝚎",key:"language",value:"en",options:["english","sinhala"]},
  {id:13,category:"Group Management",label:"𝙰𝚗𝚝𝚒 𝙻𝚒𝚗𝚔",key:"anti_link",value:"off",options:["on","off"]},
  {id:14,category:"Group Management",label:"𝙰𝚗𝚝𝚒 𝚂𝚙𝚊𝚖",key:"anti_spam",value:"off",options:["on","off"]},
  {id:15,category:"Group Management",label:"𝙰𝚗𝚝𝚒 𝙱𝚊𝚍 𝚆𝚘𝚛𝚍𝚜",key:"anti_bad_words",value:"off",options:["on","off","edit"]},
  {id:16,category:"Group Management",label:"𝚆𝚎𝚕𝚌𝚘𝚖𝚎 𝚂𝚢𝚜𝚝𝚎𝚖",key:"group_welcome",value:"off",options:["on","off","edit"]},
  {id:17,category:"Group Management",label:"𝙶𝚘𝚘𝚍𝚋𝚢𝚎 𝚂𝚢𝚜𝚝𝚎𝚖",key:"group_goodbye",value:"off",options:["on","off","edit"]},
  {id:18,category:"Group Management",label:"𝙰𝚍𝚖𝚒𝚗 𝙾𝚗𝚕𝚢",key:"admin_only",value:"off",options:["on","off"]},
  {id:19,category:"Group Management",label:"𝙶𝚛𝚘𝚞𝚙 𝙲𝚘𝚖𝚖𝚊𝚗𝚍𝚜",key:"group_commands",value:"on",options:["on","off"]},
  {id:20,category:"Movie Search",label:"𝚂𝚎𝚊𝚛𝚌𝚑 𝙻𝚊𝚗𝚐𝚞𝚊𝚐𝚎",key:"search_language",value:"en",options:["english","sinhala"]},
  {id:21,category:"Movie Search",label:"𝙳𝚎𝚏𝚊𝚞𝚕𝚝 𝚂𝚎𝚊𝚛𝚌𝚑",key:"default_search",value:"movie",options:["movie","tv","both"]},
  {id:22,category:"Movie Search",label:"𝚁𝚎𝚜𝚞𝚕𝚝𝚜 𝙻𝚒𝚖𝚒𝚝",key:"results_limit",value:"10",options:["5","10","20"]},
  {id:23,category:"Movie Search",label:"𝚂𝚑𝚘𝚠 𝚁𝚊𝚝𝚒𝚗𝚐",key:"show_rating",value:"on",options:["on","off"]},
  {id:24,category:"Movie Search",label:"𝚂𝚑𝚘𝚠 𝙾𝚟𝚎𝚛𝚟𝚒𝚎𝚠",key:"show_overview",value:"on",options:["on","off"]},
  {id:25,category:"Movie Search",label:"𝚂𝚑𝚘𝚠 𝙲𝚊𝚜𝚝",key:"show_cast",value:"on",options:["on","off"]},
  {id:26,category:"Movie Search",label:"𝚂𝚑𝚘𝚠 𝙿𝚘𝚜𝚝𝚎𝚛",key:"show_poster",value:"on",options:["on","off"]},
  {id:27,category:"Movie Search",label:"𝙰𝚍𝚞𝚕𝚝 𝙲𝚘𝚗𝚝𝚎𝚗𝚝 𝙵𝚒𝚕𝚝𝚎𝚛",key:"adult_content_filter",value:"on",options:["on"]},
  {id:28,category:"Movie Search",label:"𝙿𝚊𝚐𝚒𝚗𝚊𝚝𝚒𝚘𝚗",key:"pagination",value:"on",options:["on","off"]},
  {id:29,category:"Bot Appearance",label:"𝙱𝚘𝚝 𝙽𝚊𝚖𝚎",key:"bot_name",value:"J.A.R.V.I.S.",editable:true},
  {id:30,category:"Bot Appearance",label:"𝙾𝚠𝚗𝚎𝚛 𝙽𝚊𝚖𝚎",key:"owner_name",value:"",editable:true},
  {id:31,category:"Bot Appearance",label:"𝙵𝚘𝚘𝚝𝚎𝚛 𝚃𝚎𝚡𝚝",key:"footer_text",value:"",editable:true},
  {id:32,category:"Bot Appearance",label:"𝙴𝚖𝚘𝚓𝚒 𝚂𝚝𝚢𝚕𝚎",key:"emoji_style",value:"default",editable:true},
  {id:33,category:"Bot Appearance",label:"𝙲𝚞𝚜𝚝𝚘𝚖 𝚂𝚒𝚐𝚗𝚊𝚝𝚞𝚛𝚎",key:"custom_signature",value:"on",options:["on","off","edit"]},
  {id:34,category:"Security & Permissions",label:"𝚄𝚜𝚎𝚛 𝙱𝚕𝚘𝚌𝚔𝚕𝚒𝚜𝚝",key:"user_blocklist",value:"",options:["add","remove","list"]},
  {id:35,category:"Security & Permissions",label:"𝚄𝚜𝚎𝚛 𝙰𝚕𝚕𝚘𝚠𝚕𝚒𝚜𝚝",key:"user_allowlist",value:"",options:["add","remove","list"]},
  {id:36,category:"Security & Permissions",label:"𝙰𝚍𝚖𝚒𝚗 𝙿𝚎𝚛𝚖𝚒𝚜𝚜𝚒𝚘𝚗𝚜",key:"admin_permissions",value:"",options:["grant","revoke","list"],ownerOnly:true},
  {id:37,category:"Security & Permissions",label:"𝙲𝚘𝚖𝚖𝚊𝚗𝚍 𝙲𝚘𝚘𝚕𝚍𝚘𝚠𝚗",key:"command_cooldown",value:"0s",editable:true},
  {id:38,category:"Security & Permissions",label:"𝚁𝚊𝚝𝚎 𝙻𝚒𝚖𝚒𝚝",key:"rate_limit",value:"on",options:["on","off"]},
  {id:39,category:"Security & Permissions",label:"𝙾𝚠𝚗𝚎𝚛 𝙿𝚛𝚘𝚝𝚎𝚌𝚝𝚒𝚘𝚗",key:"owner_protection",value:"on",options:["on","off"],ownerOnly:true},
  {id:40,category:"Automation",label:"𝙰𝚞𝚝𝚘 𝚁𝚎𝚊𝚌𝚝",key:"automation_auto_react",value:"on",options:["on","off"]},
  {id:41,category:"Automation",label:"𝙰𝚞𝚝𝚘 𝚁𝚎𝚜𝚝𝚊𝚛𝚝",key:"auto_restart",value:"on",options:["on","off"],ownerOnly:true},
  {id:42,category:"Automation",label:"𝙰𝚞𝚝𝚘 𝙱𝚊𝚌𝚔𝚞𝚙",key:"auto_backup",value:"off",options:["on","off"],ownerOnly:true},
  {id:43,category:"Automation",label:"𝙳𝚊𝚒𝚕𝚢 𝚁𝚎𝚙𝚘𝚛𝚝",key:"daily_report",value:"off",options:["on","off"]},
  {id:44,category:"Automation",label:"𝙴𝚛𝚛𝚘𝚛 𝙽𝚘𝚝𝚒𝚏𝚒𝚌𝚊𝚝𝚒𝚘𝚗𝚜",key:"error_notifications",value:"on",options:["on","off"]},
  {id:45,category:"Automation",label:"𝙲𝚘𝚗𝚗𝚎𝚌𝚝𝚒𝚘𝚗 𝙰𝚕𝚎𝚛𝚝",key:"connection_alert",value:"on",options:["on","off"]},
  {id:46,category:"Automation",label:"𝚂𝚌𝚑𝚎𝚍𝚞𝚕𝚎𝚍 𝙼𝚎𝚜𝚜𝚊𝚐𝚎𝚜",key:"scheduled_messages",value:"",options:["add","remove","list"],ownerOnly:true},
  {id:47,category:"Owner Dashboard",label:"𝙱𝚘𝚝 𝚂𝚝𝚊𝚝𝚒𝚜𝚝𝚒𝚌𝚜",key:"dashboard_bot_stats",value:"not configured",options:["view"],ownerOnly:true},
  {id:48,category:"Owner Dashboard",label:"𝙰𝚌𝚝𝚒𝚟𝚎 𝚄𝚜𝚎𝚛𝚜",key:"dashboard_active_users",value:"not configured",options:["view"],ownerOnly:true},
  {id:49,category:"Owner Dashboard",label:"𝙲𝚘𝚖𝚖𝚊𝚗𝚍 𝚂𝚝𝚊𝚝𝚒𝚜𝚝𝚒𝚌𝚜",key:"dashboard_command_stats",value:"not configured",options:["view"],ownerOnly:true},
  {id:50,category:"Owner Dashboard",label:"𝚂𝚎𝚊𝚛𝚌𝚑 𝚂𝚝𝚊𝚝𝚒𝚜𝚝𝚒𝚌𝚜",key:"dashboard_search_stats",value:"not configured",options:["view"],ownerOnly:true},
  {id:51,category:"Owner Dashboard",label:"𝙰𝚍𝚖𝚒𝚗 𝙰𝚌𝚝𝚒𝚟𝚒𝚝𝚢",key:"dashboard_admin_activity",value:"not configured",options:["view"],ownerOnly:true},
  {id:52,category:"Owner Dashboard",label:"𝙳𝚊𝚝𝚊𝚋𝚊𝚜𝚎 𝚂𝚝𝚊𝚝𝚞𝚜",key:"dashboard_database_status",value:"not checked",options:["check"],ownerOnly:true},
  {id:53,category:"Owner Dashboard",label:"𝚂𝚎𝚛𝚟𝚎𝚛 𝚂𝚝𝚊𝚝𝚞𝚜",key:"dashboard_server_status",value:"not checked",options:["check"],ownerOnly:true},
  {id:54,category:"Owner Dashboard",label:"𝙰𝙿𝙸 𝚂𝚝𝚊𝚝𝚞𝚜",key:"dashboard_api_status",value:"not checked",options:["check"],ownerOnly:true},
  {id:55,category:"Owner Dashboard",label:"𝙴𝚡𝚙𝚘𝚛𝚝 𝙳𝚊𝚝𝚊",key:"dashboard_export_data",value:"not exported",options:["export"],ownerOnly:true}
];

const permissionFor = (item: SettingDef) => `settings:${item.key}`;
const normalizeJid = (value: string) => {
  const clean = value.trim().toLowerCase().replace(/:\d+(?=@)/, "");
  if (/^\d{8,16}$/.test(clean)) return `${clean}@s.whatsapp.net`;
  if (/^\d{8,16}@s\.whatsapp\.net$/.test(clean)) return clean;
  return null;
};
function renderPanel(values: Record<string, string>) {
  const groups = [...new Set(settings.map((item) => item.category))];
  const lines = ["╭─「  🅂🄴🅃🅃🄸🄽🄶🅂  」", "│"];
  for (const group of groups) {
    lines.push(`✇ 𝐂𝐚𝐭𝐞𝐠𝐨𝐫𝐲. ${group}`, "│");
    for (const item of settings.filter((entry) => entry.category === group)) {
      const current = values[item.key] ?? item.value;
      lines.push(`│ ${String(item.id).padStart(2, "0")}. ${item.label} [${current || "not set"}]`);
      (item.options || (item.editable ? ["edit"] : [])).forEach((option, index) => {
        const display = option === "public" ? "𝐩𝐮𝐛𝐥𝐢𝐜"
          : option === "private" ? "𝐩𝐫𝐢𝐯𝐚𝐭𝐞"
          : option === "group" ? "𝐠𝐫𝐨𝐮𝐩"
          : option === "on" ? "𝐨𝐧"
          : option === "off" ? "𝐨𝐟𝐟"
          : option === "edit" ? "𝐞𝐝𝐢𝐭"
          : option === "reset" ? "𝐫𝐞𝐬𝐞𝐭"
          : option === "english" ? "𝐞𝐧𝐠𝐥𝐢𝐬𝐡"
          : option === "sinhala" ? "𝐬𝐢𝐧𝐡𝐚𝐥𝐚"
          : `𝐨𝐩𝐭𝐢𝐨𝐧 ${option}`;
        lines.push(`╎${String.fromCharCode(65 + index)} - ${display}`);
      });
      lines.push("│");
    }
  }
  lines.push("╰──────────────●●►", "", "Use: `.settings <number> <option> [value]`", "Example: `.settings 01 A`", "Example: `.settings 29 A J.A.R.V.I.S.`", "", "©𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈  𝐉.𝐀.𝐑.𝐕.𝐒. </>");
  return lines.join("\n");
}

async function sendPanel(sock: WASocket, jid: string) {
  const stored = await getBotSettings(settings.map((item) => item.key));
  const values: Record<string, string> = {};
  for (const item of settings) values[item.key] = stored[item.key] ?? item.value;
  await safeSendText(sock, jid, renderPanel(values));
}

function parseDuration(value: string) {
  return /^(0|[1-9]\d{0,3})(s|sec|m|min)?$/i.test(value);
}

export async function handleSettings(sock: WASocket, jid: string, args: string, actorJid = jid) {
  const input = args.trim();
  const [first = "", second = "", ...tail] = input.split(/\s+/);
  const value = tail.join(" ").trim();

  if (!input || first.toLowerCase() === "help" || first.toLowerCase() === "panel") {
    if (!await isOwner(actorJid) && !await adminCan(actorJid, "settings:panel")) {
      await safeSendText(sock, jid, "🔒 Settings Panel එක බැලීමට Owner/Admin අවසර අවශ්‍යයි.");
      return true;
    }
    await sendPanel(sock, jid);
    return true;
  }

  if (first.toLowerCase() === "admin") {
    if (!await isOwner(actorJid)) {
      await safeSendText(sock, jid, "🔒 Admin කළමනාකරණය Ownerට පමණයි.");
      return true;
    }
    const operation = second.toLowerCase();
    const number = tail[0] || "";
    const target = normalizeJid(number);
    if (operation === "list") {
      const admins = await listAdmins();
      await safeSendText(sock, jid, admins.length
        ? `╭─「 ADMINS 」\n${admins.map((a) => `│ ${a.wa_jid}\n│ Permissions: ${a.permissions.join(", ") || "none"}`).join("\n") }\n╰──────────────●●►`
        : "Adminලා කිසිවෙක් නැහැ.");
      return true;
    }
    if (!target || !["add", "remove"].includes(operation)) {
      await safeSendText(sock, jid, "භාවිතය: `.settings admin add 947XXXXXXXX` / `.settings admin remove 947XXXXXXXX` / `.settings admin list`");
      return true;
    }
    if (env.ownerJid && target === normalizeJid(env.ownerJid)) {
      await safeSendText(sock, jid, "Owner account එක Admin ලෙස වෙනස් කළ නොහැක.");
      return true;
    }
    if (operation === "add") {
      await addAdmin(target, actorJid);
      await safeSendText(sock, jid, `✅ Admin එකතු කළා: ${target}\nDefault permission: settings:welcome`);
    } else {
      await removeAdmin(target);
      await safeSendText(sock, jid, `✅ Admin අවසර ඉවත් කළා: ${target}`);
    }
    return true;
  }

  if (first.toLowerCase() === "maintenance") {
    if (!await isOwner(actorJid)) {
      await safeSendText(sock, jid, "🔒 Maintenance Mode වෙනස් කළ හැක්කේ Ownerට පමණයි.");
      return true;
    }
    const mode = second.toLowerCase();
    if (!["on", "off"].includes(mode)) {
      await safeSendText(sock, jid, "භාවිතය: `.settings maintenance on` / `.settings maintenance off`");
      return true;
    }
    await setBotSetting("maintenance", mode, actorJid);
    await safeSendText(sock, jid, `Maintenance Mode: ${mode.toUpperCase()}`);
    return true;
  }

  const id = Number(first);
  const item = settings.find((entry) => entry.id === id);
  if (!item) {
    await safeSendText(sock, jid, "Setting අංකය හඳුනාගත නොහැක. `.settings` යවලා panel එක බලන්න.");
    return true;
  }
  if (item.ownerOnly && !await isOwner(actorJid)) {
    await safeSendText(sock, jid, "🔒 මේ Setting එක වෙනස් කළ හැක්කේ Ownerට පමණයි.");
    return true;
  }
  if (!await isOwner(actorJid) && !await adminCan(actorJid, permissionFor(item))) {
    await safeSendText(sock, jid, "🔒 මේ Setting එක වෙනස් කිරීමට ඔබට අවසර නැහැ.");
    return true;
  }

  const choices = item.options || (item.editable ? ["edit"] : []);
  const choiceIndex = second.toUpperCase().charCodeAt(0) - 65;
  const choice = choices[choiceIndex];
  if (!choice) {
    await safeSendText(sock, jid, `භාවිතය: .settings ${String(item.id).padStart(2, "0")} <option letter>${item.editable ? " <value>" : ""}`);
    return true;
  }

  if (item.id === 27 && choice !== "on") {
    await safeSendText(sock, jid, "🔐 Adult Content Filter ආරක්ෂාව සඳහා ON ලෙසම තබා ඇත.");
    return true;
  }

  if ([34, 35].includes(item.id)) {
    const listKey = item.id === 34 ? "user_blocklist_data" : "user_allowlist_data";
    const raw = await getBotSetting(listKey);
    let entries: string[] = [];
    try { const parsed: unknown = raw ? JSON.parse(raw) : []; if (Array.isArray(parsed)) entries = parsed.filter((x): x is string => typeof x === "string"); } catch { entries = []; }
    if (choice === "list") {
      await safeSendText(sock, jid, entries.length ? entries.join("\n") : "ලැයිස්තුව හිස්.");
      return true;
    }
    const target = normalizeJid(value);
    if (!target) { await safeSendText(sock, jid, "වලංගු WhatsApp අංකයක් දෙන්න. උදා: `.settings 34 A 947XXXXXXXX`"); return true; }
    entries = choice === "add" ? [...new Set([...entries, target])] : entries.filter((entry) => entry !== target);
    await setBotSetting(listKey, JSON.stringify(entries), actorJid);
    await safeSendText(sock, jid, `✅ ${target} ${choice === "add" ? "ලැයිස්තුවට එකතු කළා" : "ලැයිස්තුවෙන් ඉවත් කළා"}.`);
    return true;
  }

  if (item.id === 36) {
    const [targetRaw, permissionRaw] = value.split(/\s+/);
    if (choice === "list") {
      const admins = await listAdmins();
      await safeSendText(sock, jid, admins.map((a) => `${a.wa_jid}: ${a.permissions.join(", ")}`).join("\n") || "Adminලා නැහැ.");
      return true;
    }
    const target = targetRaw ? normalizeJid(targetRaw) : null;
    if (!target || !permissionRaw) {
      await safeSendText(sock, jid, "භාවිතය: `.settings 36 A 947XXXXXXXX settings:welcome` හෝ `.settings 36 B 947XXXXXXXX settings:welcome`\nPermissions list: `.settings 36 C`");
      return true;
    }
    const admins = await listAdmins();
    const admin = admins.find((entry) => entry.wa_jid === target);
    if (!admin) { await safeSendText(sock, jid, "එම අංකය Admin ලැයිස්තුවේ නැහැ. මුලින් Admin ලෙස add කරන්න."); return true; }
    const permissions = choice === "grant"
      ? [...new Set([...admin.permissions, permissionRaw])]
      : admin.permissions.filter((permission) => permission !== permissionRaw);
    await setAdminPermissions(target, permissions);
    await safeSendText(sock, jid, `✅ ${target} සඳහා ${permissionRaw} ${choice === "grant" ? "grant" : "revoke"} කළා.`);
    return true;
  }

  if (choices.length === 1 && ["view", "check", "export"].includes(choice)) {
    if (choice === "check" && item.id === 52) {
      const status = await getBotSetting("maintenance");
      await safeSendText(sock, jid, `Database setting read: ${status === null ? "not configured / unavailable" : "reachable"}`);
    } else {
      await safeSendText(sock, jid, `${item.label}: ${(await getBotSetting(item.key) ?? item.value)}\nමෙම dashboard metric/action එක සඳහා වෙනම runtime integration එකක් තවම සම්බන්ධ කර නැහැ.`);
    }
    return true;
  }

  if (["edit", "reset"].includes(choice)) {
    if (choice === "reset") {
      await setBotSetting(item.key, item.value, actorJid);
      await safeSendText(sock, jid, `✅ ${item.label} default value එකට reset කළා.`);
      return true;
    }
    if (!value) {
      await safeSendText(sock, jid, `අලුත් value එක යවන්න. උදා: .settings ${String(item.id).padStart(2, "0")} ${second} <value>`);
      return true;
    }
    if ([11, 37].includes(item.id) && !parseDuration(value)) {
      await safeSendText(sock, jid, "කාලය 0s, 10s හෝ 2m වැනි ආකාරයකින් දෙන්න.");
      return true;
    }
    await setBotSetting(item.key, value.slice(0, 500), actorJid);
    await safeSendText(sock, jid, `✅ ${item.label} update කළා. (මෙම අගය save වුණා; runtime feature එක වෙනම සම්බන්ධ කළ යුතුයි.)`);
    return true;
  }

  await setBotSetting(item.key, choice, actorJid);
  await safeSendText(sock, jid, `✅ ${item.label}: ${choice}\nSupabase එකේ save කළා. Runtime එකට බලපාන ලෙස සම්බන්ධ කිරීම අවශ්‍ය විය හැකියි.`);
  return true;
}
