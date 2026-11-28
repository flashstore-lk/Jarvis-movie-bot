import type { WASocket } from "@whiskeysockets/baileys";
import { performance } from "node:perf_hooks";

import { mediaProvider } from "../services/media-provider";
import {
  setPendingSelection,
  getPendingSelection,
  clearPendingSelection
} from "./state";

import {
  recordSearch,
  saveLibraryItem,
  listLibrary,
  removeLibraryItem,
  getBotSetting,
  isOwner,
  adminCan
} from "../database/supabase";

import {
  handleConsentCommand,
  isOptedOut,
  safeSendMessage,
  safeSendText
} from "./safety";

import { handleSettings } from "./admin";
import type { MovieResult } from "../services/types";
import { rememberDownloadOptions, getDownloadOptions, queueDownload } from "../download/manager";

// --------------------------------------------------
// COMMAND LIST
// --------------------------------------------------

const COMMANDS = [
  ".mv <movie> — Movie Search",
  ".tv <series> — TV Series Search",
  ".id <IMDb ID> — IMDb Search",
  "↳ Reply with a quality number — Download selected quality",
  ".jid — Show Your WhatsApp JID",
  ".popular — Popular Movies",
  ".trending — Trending Movies",
  ".top — Top Rated Movies",
  ".upcoming — Upcoming Movies",
  ".fav [add/remove/list] — Favorites",
  ".watchlist [add/remove/list] — Watchlist",
  ".help — Bot Use Guide",
  ".menu — All Commands",
  ".status — Bot Status",
  ".ping — Response Speed",
  ".about — Bot Information",
  ".settings — Owner/Admin Settings"
];

const HELP = [
  "╭─「 J.A.R.V.I.S. MOVIE BOT 」",
  "│",
  "*MOVIE SEARCH*",
  ".mv Deadpool",
  ".tv Breaking Bad",
  ".id tt1431045",
  "↳ Reply to the movie details with a quality number (final number = ALL QUALITY)",
  "",
  "*WHATSAPP*",
  ".jid",
  "",
  "*DISCOVERY*",
  ".popular",
  ".trending",
  ".top",
  ".upcoming",
  "",
  "*PERSONAL LISTS*",
  ".fav add Deadpool",
  ".fav list",
  ".fav remove Deadpool",
  ".watchlist add Interstellar",
  ".watchlist list",
  ".watchlist remove Interstellar",
  "",
  "*BOT*",
  ".help / .menu / .status / .ping / .about",
  ".settings (Owner/Admin)",
  "",
  "Search Results message එකට Reply කරලා අංකයක් යවන්න.",
  "ඊළඟ පිටුවට A යවන්න.",
  "",
  "╰──────────────●●►"
].join("\n");

function shorten(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

function formatSearchResults(movies: MovieResult[]) {
  const lines = ["╭─「 ꜱᴇᴀʀᴄʜ ʀᴇꜱᴜʟᴛꜱ 」", "│"];
  movies.forEach((movie, i) => {
    const title = movie.title.replace(/`/g, "'").replace(/\n/g, " ").trim();
    lines.push(`│ 🎬 ${i + 1} ☞ \`${title}${movie.year ? ` (${movie.year})` : ""}\``);
    lines.push(`│    ⭐ ${movie.rating || "Not available"}/10 | 🔞 ${movie.ageRating || "Not rated"}`);
    if (movie.sourceBadge) lines.push(`│    🏷️ ${shorten(movie.sourceBadge, 55)}`);
    lines.push(`│    📝 ${shorten(movie.overview || "Open this result to view details.", 115)}`);
    if (i !== movies.length - 1) lines.push("│");
  });
  lines.push(
    "",
    "╰──────────────●●►",
    "",
    "📌 *Reply with the number to see details.*",
    "",
    "╭─ 「ᴏᴛʜᴇʀꜱ ᴄᴏᴍᴍᴀɴᴅꜱ」",
    "│",
    "│    A - `More...`",
    "│",
    "╰──────────────●●►",
    "",
    "> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴍᴏᴠɪᴇ ʜᴜʙ </>"
  );
  return lines.join("\n");
}

function formatDetails(movie: MovieResult, downloadLinks: Array<{ label: string; url: string }> = []) {
  const lines = [
    `*${movie.title}${movie.year ? ` (${movie.year})` : ""}*`,
    "",
    `│ 🎟️ *ʏᴇᴀʀ:* \`${movie.year || "Unknown"}\``,
    `│ 🆔 *ɪᴍᴅʙ:* \`${movie.imdbId || "Unavailable"}\``,
    `│ ⭐ *ʀᴀᴛɪɴɢ:* \`${movie.rating || "Unavailable"}\``,
    `│ ⏳ *ʀuntime:* \`${movie.runtime ? `${movie.runtime} MIN` : "Unknown"}\``,
    `│ 🌍 *ᴄᴏᴜɴᴛʀʏ:* \`${movie.countries?.join(", ") || "Unknown"}\``,
    `│ 🎬 *ᴅɪʀᴇᴄᴛᴏʀ:* \`${movie.directors?.join(", ") || "Unknown"}\``,
    "│ │",
    `│ \`${[movie.ageRating, ...(movie.genres || [])].filter(Boolean).join(", ") || "Genres unavailable"}\``
  ];
  if (movie.overview) lines.push("", `📝 *Description:* ${shorten(movie.overview, 700)}`);
  if (movie.cast?.length) lines.push("", `🎭 *Cast:* ${shorten(movie.cast.join(", "), 350)}`);
  if (movie.subtitleBy) lines.push(`📝 *Subtitles:* ${shorten(movie.subtitleBy, 120)}`);

  if (downloadLinks.length) {
    lines.push("│", "⚖️ *𝖲𝖤𝖫𝖤𝖢𝖳 𝖰𝖴𝖠𝖫𝖨𝖳𝖸 🔻*", "");
    downloadLinks.forEach((link, index) => lines.push(`${index + 1}➢ \`${link.label}\``));
    lines.push(`${downloadLinks.length + 1}➢ \`ALL QUALITY\``, "│", "╰─────────────➢");
    lines.push("", "> ʀᴇᴘʟʏ ᴛᴏ ᴛʜɪꜱ ᴍᴇꜱꜱᴀɢᴇ ᴡɪᴛʜ ᴛʜᴇ ǫᴜᴀʟɪᴛʏ ɴᴜᴍʙᴇʀ.");
  } else if (movie.sourceProvider === "cinesubz") {
    lines.push("", "📥 Download options are currently unavailable from the CineSubz API.");
  }
  lines.push("", "© ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴍᴏᴠɪᴇ ʜᴜʙ </>");
  return lines.join("\n");
}

async function sendDetails(sock: WASocket, jid: string, movie: MovieResult) {
  let downloadLinks: Array<{ label: string; url: string }> = [];
  if (movie.mediaType !== "tv" && movie.sourceProvider === "cinesubz" && movie.sourceUrl) {
    try {
      downloadLinks = await mediaProvider.getAuthorizedLinks(movie.sourceUrl);
    } catch (error) {
      console.warn("[CineSubz] Download link resolution failed:", error);
    }
  }

  const caption = formatDetails(movie, downloadLinks);
  let sent: Awaited<ReturnType<typeof safeSendMessage>> | undefined;
  if (movie.posterUrl) {
    try {
      sent = await safeSendMessage(sock, jid, { image: { url: movie.posterUrl }, caption });
    } catch (error) {
      console.warn("[Bot] Poster delivery failed:", error);
    }
  }
  if (!sent) sent = await safeSendMessage(sock, jid, { text: caption });
  const detailsMessageId = sent?.key?.id;
  if (detailsMessageId && downloadLinks.length) {
    rememberDownloadOptions(jid, detailsMessageId, movie.title, downloadLinks);
  }
}

async function sendPage(sock: WASocket, jid: string, query: string, page: number, type: "movie" | "tv" = "movie") {
  const results = type === "tv"
    ? await mediaProvider.searchTv(query, page)
    : await mediaProvider.search(query, page);
  if (!results.length) {
    await safeSendText(sock, jid, page === 1 ? "Search result එකක් හමු වුණේ නැහැ." : "තවත් Search Results නැහැ.");
    return;
  }
  const sent = await safeSendMessage(sock, jid, { text: formatSearchResults(results) });
  const id = sent?.key?.id;
  if (!id) {
    await safeSendText(sock, jid, "Search message ID එක ලබාගැනීමට නොහැකි වුණා.");
    return;
  }
  setPendingSelection(jid, id, `${type}:${query}`, page, results);
}

async function runSearch(sock: WASocket, jid: string, query: string, type: "movie" | "tv") {
  const clean = query.trim().slice(0, 100);
  if (!clean) {
    await safeSendText(sock, jid, type === "tv" ? "භාවිතය: `.tv Breaking Bad`" : "භාවිතය: `.mv Deadpool`");
    return;
  }
  const start = performance.now();
  await safeSendText(sock, jid, "🔎 Search කරමින්...");
  try {
    const results = type === "tv"
      ? await mediaProvider.searchTv(clean, 1)
      : await mediaProvider.search(clean, 1);
    await recordSearch({ jid, query: `${type}:${clean}`, resultCount: results.length });
    if (!results.length) {
      await safeSendText(sock, jid, "Result එකක් හමු වුණේ නැහැ.");
      return;
    }
    // Use the already-fetched CineSubz results rather than making a duplicate API call.
    const sent = await safeSendMessage(sock, jid, { text: formatSearchResults(results) });
    const id = sent?.key?.id;
    if (!id) {
      await safeSendText(sock, jid, "Search message ID එක ලබාගැනීමට නොහැකි වුණා.");
      return;
    }
    setPendingSelection(jid, id, `${type}:${clean}`, 1, results);
    console.log(`[Search] ${type} completed in ${Math.round(performance.now() - start)}ms`);
  } catch (error) {
    console.error("[Search] Failed:", error);
    await safeSendText(sock, jid, "Search එකේ දෝෂයක් ඇතිවුණා. පසුව නැවත උත්සාහ කරන්න.");
  }
}

async function discover(sock: WASocket, jid: string, kind: "popular" | "trending" | "top" | "upcoming") {
  try {
    const results = await mediaProvider.discover(kind, 1);
    if (!results.length) {
      await safeSendText(sock, jid, "Movies ලබාගැනීමට නොහැකි වුණා.");
      return;
    }
    const sent = await safeSendMessage(sock, jid, {
      text: `🎬 *${kind.toUpperCase()} MOVIES*\n\n${formatSearchResults(results)}`
    });
    const id = sent?.key?.id;
    if (id) setPendingSelection(jid, id, `discover:${kind}`, 1, results);
  } catch (error) {
    console.error(`[Discover] ${kind} failed:`, error);
    await safeSendText(sock, jid, "TMDB සේවාවෙන් Movies ලබාගැනීමට නොහැකි වුණා.");
  }
}

async function showLibrary(sock: WASocket, jid: string, list: "favorite" | "watchlist") {
  try {
    const items = await listLibrary(jid, list);
    if (!items.length) {
      await safeSendText(sock, jid, list === "favorite"
        ? "⭐ Favorite list එක හිස්.\n`.fav add Movie Name` භාවිතා කරන්න."
        : "📌 Watchlist එක හිස්.\n`.watchlist add Movie Name` භාවිතා කරන්න.");
      return;
    }
    const lines = [`╭─「 ${list === "favorite" ? "⭐ FAVORITES" : "📌 WATCHLIST"} 」`, "│"];
    items.forEach((item: any, i: number) => {
      lines.push(`│ ${i + 1}. *${item.title}*${item.release_year ? ` (${item.release_year})` : ""}\n│    ⭐ ${item.rating || "N/A"}/10`);
    });
    lines.push("│", "╰──────────────●●►");
    await safeSendText(sock, jid, lines.join("\n"));
  } catch (error) {
    console.error("[Library] Read failed:", error);
    await safeSendText(sock, jid, "Favorites/Watchlist භාවිතා කිරීමට Supabase migration එක ක්‍රියාත්මක කරන්න.");
  }
}

async function changeLibrary(sock: WASocket, jid: string, list: "favorite" | "watchlist", args: string) {
  const [action = "list", ...parts] = args.trim().split(/\s+/);
  const query = parts.join(" ").trim();
  if (action === "list") {
    await showLibrary(sock, jid, list);
    return;
  }
  if (!query) {
    await safeSendText(sock, jid, `භාවිතය: .${list === "favorite" ? "fav" : "watchlist"} add/remove <movie name>`);
    return;
  }
  try {
    if (action === "remove") {
      await removeLibraryItem(jid, list, query);
      await safeSendText(sock, jid, "List එකෙන් ඉවත් කළා.");
      return;
    }
    if (action !== "add") {
      await safeSendText(sock, jid, "add, remove හෝ list භාවිතා කරන්න.");
      return;
    }
    const found = /^tt\d{5,12}$/i.test(query)
      ? await mediaProvider.getByImdbId(query)
      : (await mediaProvider.search(query, 1))[0] || null;
    if (!found) {
      await safeSendText(sock, jid, "Movie එක හමු වුණේ නැහැ.");
      return;
    }
    await saveLibraryItem(jid, list, found);
    await safeSendText(sock, jid, `${list === "favorite" ? "⭐ Favorite" : "📌 Watchlist"} එකට එකතු කළා: *${found.title}*`);
  } catch (error) {
    console.error("[Library] Update failed:", error);
    await safeSendText(sock, jid, "List එක update කිරීමට නොහැකි වුණා. Supabase setup එක පරීක්ෂා කරන්න.");
  }
}

async function selectReply(sock: WASocket, jid: string, quotedId: string, answer: string) {
  const session = getPendingSelection(jid, quotedId);
  if (!session) return;
  const value = answer.trim().toUpperCase();
  const [type, query] = session.query.split(/:(.*)/s);

  if (value === "A") {
    if (type === "discover") {
      const next = await mediaProvider.discover(query as "popular" | "trending" | "top" | "upcoming", session.page + 1);
      if (!next.length) {
        await safeSendText(sock, jid, "තවත් Search Results නැහැ.");
        return;
      }
      const sent = await safeSendMessage(sock, jid, { text: `🎬 *${query.toUpperCase()} MOVIES*\n\n${formatSearchResults(next)}` });
      const id = sent?.key?.id;
      if (id) setPendingSelection(jid, id, `discover:${query}`, session.page + 1, next);
      return;
    }
    await sendPage(sock, jid, query, session.page + 1, type === "tv" ? "tv" : "movie");
    return;
  }

  if (!/^\d{1,2}$/.test(value)) return;
  const selected = session.results[Number(value) - 1];
  if (!selected) {
    await safeSendText(sock, jid, "වැරදි අංකයක්. List එකේ අංකයක් Reply කරන්න.");
    return;
  }
  try {
    const details = selected.mediaType === "tv"
      ? await mediaProvider.getTvDetails(selected.id)
      : await mediaProvider.getDetails(selected.id);
    if (!details) {
      await safeSendText(sock, jid, "Details ලබාගැනීමට නොහැකි වුණා.");
      return;
    }
    clearPendingSelection(jid);
    await sendDetails(sock, jid, details);
  } catch (error) {
    console.error("[Details] Failed:", error);
    await safeSendText(sock, jid, "Details ලබාගැනීමේදී දෝෂයක් ඇතිවුණා.");
  }
}

export async function handleMessage(
  sock: WASocket,
  jid: string,
  text: string,
  quotedMessageId?: string,
  senderJid = jid
): Promise<void> {
  const message = text.trim();
  if (!message) return;

  if (!message.startsWith(".")) {
    if (await isOptedOut(senderJid)) return;
    if (quotedMessageId && /^\d{1,2}$/.test(message) && getDownloadOptions(jid, quotedMessageId)) {
      if (jid.endsWith("@g.us") && !(await isOwner(senderJid)) && !(await adminCan(senderJid, "download:request"))) {
        await safeSendText(sock, jid, "🔒 Group එකකින් download request කිරීමට Owner/Admin අවසර අවශ්‍යයි.");
        return;
      }
      try {
        const job = await queueDownload(jid, senderJid, message, quotedMessageId);
        await safeSendText(sock, jid, `⏳ *Download queued*\n🎬 ${job.title}\nFiles: ${job.fileCount}\nJob: ${job.jobId.slice(0, 8)}\n\nGitHub Worker එක සකස් කර WhatsApp වෙත එවයි.`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Download request failed.";
        await safeSendText(sock, jid, `❌ Download request එක ආරම්භ කළ නොහැක.\n${detail}`);
      }
      return;
    }
    if (quotedMessageId && (/^A$/i.test(message) || /^\d{1,2}$/.test(message))) {
      await selectReply(sock, jid, quotedMessageId, message);
    }
    return;
  }

  const line = message.slice(1).trim();
  if (!line) return;
  const [rawCommand, ...args] = line.split(/\s+/);
  const command = rawCommand.toLowerCase();
  const argument = args.join(" ").trim();

  if (await handleConsentCommand(sock, senderJid, line)) return;
  if (await isOptedOut(senderJid)) return;

  const maintenance = await getBotSetting("maintenance");
  if (maintenance === "on" && !["status", "ping", "about", "help", "menu", "jid", "settings"].includes(command)) {
    await safeSendText(sock, jid, "🛠️ Bot එක Maintenance Mode එකේ. ටික වේලාවකින් නැවත උත්සාහ කරන්න.");
    return;
  }

  switch (command) {
    case "help":
    case "menu": {
      await safeSendText(sock, jid, HELP);
      return;
    }
    case "jid": {
      await safeSendText(sock, jid, [
        "╭─「 ᴡʜᴀᴛꜱᴀᴘᴘ ɪᴅ 」",
        "│",
        "│ 👤 *Your JID:*",
        `│ \`${senderJid}\``,
        "│",
        "╰──────────────●●►",
        "",
        "📌 Use this JID for OWNER_JID configuration."
      ].join("\n"));
      return;
    }
    case "mv":
    case "movie": {
      await runSearch(sock, jid, argument, "movie");
      return;
    }
    case "download": {
      if (jid.endsWith("@g.us") && !(await isOwner(senderJid)) && !(await adminCan(senderJid, "download:request"))) {
        await safeSendText(sock, jid, "🔒 Group එකකින් download request කිරීමට Owner/Admin අවසර අවශ්‍යයි.");
        return;
      }
      if (!argument) {
        await safeSendText(sock, jid, "Movie Details message එකට quality number එකෙන් Reply කරන්න. උදා: 1 හෝ ALL QUALITY සඳහා අවසාන අංකය.");
        return;
      }
      try {
        const job = await queueDownload(jid, senderJid, argument, quotedMessageId);
        await safeSendText(sock, jid, `⏳ *Download queued*\n🎬 ${job.title}\nFiles: ${job.fileCount}\nJob: ${job.jobId.slice(0, 8)}\n\nGitHub Worker එක file එක සකස් කර WhatsApp වෙත එවයි.`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Download request failed.";
        await safeSendText(sock, jid, `❌ Download request එක ආරම්භ කළ නොහැක.\n${detail}`);
      }
      return;
    }
    case "tv": {
      await runSearch(sock, jid, argument, "tv");
      return;
    }
    case "id": {
      const found = await mediaProvider.getByImdbId(argument);
      if (!found) {
        await safeSendText(sock, jid, "IMDb ID එකෙන් Movie/Series එකක් හමු වුණේ නැහැ.");
        return;
      }
      await sendDetails(sock, jid, found);
      return;
    }
    case "popular":
    case "trending":
    case "top":
    case "upcoming": {
      await discover(sock, jid, command);
      return;
    }
    case "fav": {
      await changeLibrary(sock, senderJid, "favorite", argument || "list");
      return;
    }
    case "watchlist": {
      await changeLibrary(sock, senderJid, "watchlist", argument || "list");
      return;
    }
    case "settings": {
      await handleSettings(sock, jid, argument, senderJid);
      return;
    }
    case "status": {
      await safeSendText(sock, jid, [
        "🟢 *J.A.R.V.I.S. STATUS*",
        "",
        "WhatsApp: Connected",
        "Movie Search: CineSubz API only",
        "Movie Info: CineSubz API",
        "TV Search: TMDB",
        "Download: GitHub Actions worker → Railway → WhatsApp",
        "Favorites/Watchlist: Supabase"
      ].join("\n"));
      return;
    }
    case "ping": {
      const start = performance.now();
      await safeSendText(sock, jid, `🏓 Pong!\nResponse: ${Math.round(performance.now() - start)} ms`);
      return;
    }
    case "about": {
      await safeSendText(sock, jid, [
        "🤖 *J.A.R.V.I.S. MOVIE BOT*",
        "",
        "Movie Search & Info: CineSubz API",
        "TV & discovery metadata: TMDB",
        "WhatsApp: Baileys",
        "Database: Supabase",
        "Download worker: GitHub Actions + Railway WhatsApp delivery.",
        "",
        "Use `.menu` to view commands."
      ].join("\n"));
      return;
    }
    default: {
      await safeSendText(sock, jid, "Command එක හඳුනාගන්න බැහැ. `.menu` යවන්න.");
      return;
    }
  }
}
