
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
  getBotSetting
} from "../database/supabase";

import {
  handleConsentCommand,
  isOptedOut,
  safeSendMessage,
  safeSendText
} from "./safety";

import { handleSettings } from "./admin";
import type { MovieResult } from "../services/types";

// --------------------------------------------------
// COMMAND LIST
// --------------------------------------------------

const COMMANDS = [
  ".mv <movie> — Movie Search",
  ".tv <series> — TV Series Search",
  ".id <IMDb ID> — IMDb Search",
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

// --------------------------------------------------
// HELP MENU
// --------------------------------------------------

const HELP = [
  "╭─「 J.A.R.V.I.S. MOVIE BOT 」",
  "│",
  "*MOVIE SEARCH*",
  ".mv Deadpool",
  ".tv Breaking Bad",
  ".id tt1431045",
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

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function shorten(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();

  return clean.length <= max
    ? clean
    : `${clean.slice(0, max - 1).trim()}…`;
}

// --------------------------------------------------
// SEARCH RESULTS FORMAT
// --------------------------------------------------

function formatSearchResults(movies: MovieResult[]) {
  const lines = [
    "╭─「 ꜱᴇᴀʀᴄʜ ʀᴇꜱᴜʟᴛꜱ 」",
    "│"
  ];

  movies.forEach((movie, i) => {
    const title = movie.title
      .replace(/`/g, "'")
      .replace(/\n/g, " ")
      .trim();

    lines.push(
      `│ 🎬 ${i + 1} ☞ \`${title}${movie.year ? ` (${movie.year})` : ""}\``
    );

    lines.push(
      `│    ⭐ ${movie.rating || "Not available"}/10 | 🔞 ${movie.ageRating || "Not rated"}`
    );

    lines.push(
      `│    📝 ${shorten(movie.overview || "No overview available.", 115)}`
    );

    if (i !== movies.length - 1) {
      lines.push("│");
    }
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

// --------------------------------------------------
// MOVIE DETAILS FORMAT
// --------------------------------------------------

function formatDetails(movie: MovieResult) {
  return [
    `🎬 *${movie.title}${movie.year ? ` (${movie.year})` : ""}*`,
    "",
    `│ 🎟️ *YEAR:* \`${movie.year || "Unknown"}\``,
    `│ 🆔 *IMDb ID:* \`${movie.imdbId || "Unavailable"}\``,
    `│ ⭐ *TMDB RATING:* \`${movie.rating ? `${movie.rating}/10` : "Unavailable"}\``,
    `│ ⏳ *RUNTIME:* \`${movie.runtime ? `${movie.runtime} MIN` : "Unknown"}\``,
    `│ 🌍 *COUNTRY:* \`${movie.countries?.join(", ") || "Unknown"}\``,
    `│ 🎬 *DIRECTOR:* \`${movie.directors?.join(", ") || "Unknown"}\``,
    `│ 🎭 *GENRES:* \`${movie.genres?.join(", ") || "Unknown"}\``,
    `│ 🔞 *AGE RATING:* \`${movie.ageRating || "Not rated"}\``,
    "",
    "*OVERVIEW:*",
    movie.overview || "No overview available.",
    "",
    `🔗 *TMDB:* ${movie.sourceUrl || "Unavailable"}`,
    "",
    "© POWERED BY J.A.R.V.I.S."
  ].join("\n");
}

// --------------------------------------------------
// SEND MOVIE DETAILS
// --------------------------------------------------

async function sendDetails(
  sock: WASocket,
  jid: string,
  movie: MovieResult
) {
  const caption = formatDetails(movie);

  if (movie.posterUrl) {
    try {
      await safeSendMessage(sock, jid, {
        image: { url: movie.posterUrl },
        caption
      });

      return;
    } catch (error) {
      console.warn(
        "[Bot] Poster delivery failed:",
        error
      );
    }
  }

  await safeSendText(sock, jid, caption);
}

// --------------------------------------------------
// SEARCH PAGE
// --------------------------------------------------

async function sendPage(
  sock: WASocket,
  jid: string,
  query: string,
  page: number,
  type: "movie" | "tv" = "movie"
) {
  const results =
    type === "tv"
      ? await mediaProvider.searchTv(query, page)
      : await mediaProvider.search(query, page);

  if (!results.length) {
    await safeSendText(
      sock,
      jid,
      page === 1
        ? "Search result එකක් හමු වුණේ නැහැ."
        : "තවත් Search Results නැහැ."
    );

    return;
  }

  const sent = await safeSendMessage(sock, jid, {
    text: formatSearchResults(results)
  });

  const id = sent?.key?.id;

  if (!id) {
    await safeSendText(
      sock,
      jid,
      "Search message ID එක ලබාගැනීමට නොහැකි වුණා."
    );

    return;
  }

  setPendingSelection(
    jid,
    id,
    `${type}:${query}`,
    page,
    results
  );
}

// --------------------------------------------------
// RUN MOVIE / TV SEARCH
// --------------------------------------------------

async function runSearch(
  sock: WASocket,
  jid: string,
  query: string,
  type: "movie" | "tv"
) {
  const clean = query.trim().slice(0, 100);

  if (!clean) {
    await safeSendText(
      sock,
      jid,
      type === "tv"
        ? "භාවිතය: `.tv Breaking Bad`"
        : "භාවිතය: `.mv Deadpool`"
    );

    return;
  }

  const start = performance.now();

  await safeSendText(
    sock,
    jid,
    "🔎 Search කරමින්..."
  );

  try {
    const results =
      type === "tv"
        ? await mediaProvider.searchTv(clean, 1)
        : await mediaProvider.search(clean, 1);

    await recordSearch({
      jid,
      query: `${type}:${clean}`,
      resultCount: results.length
    });

    if (!results.length) {
      await safeSendText(
        sock,
        jid,
        "Result එකක් හමු වුණේ නැහැ."
      );

      return;
    }

    await sendPage(sock, jid, clean, 1, type);

    console.log(
      `[Search] ${type} completed in ${Math.round(performance.now() - start)}ms`
    );
  } catch (error) {
    console.error("[Search] Failed:", error);

    await safeSendText(
      sock,
      jid,
      "Search එකේ දෝෂයක් ඇතිවුණා. පසුව නැවත උත්සාහ කරන්න."
    );
  }
}

// --------------------------------------------------
// DISCOVERY
// --------------------------------------------------

async function discover(
  sock: WASocket,
  jid: string,
  kind: "popular" | "trending" | "top" | "upcoming"
) {
  try {
    const results = await mediaProvider.discover(kind, 1);

    if (!results.length) {
      await safeSendText(
        sock,
        jid,
        "Movies ලබාගැනීමට නොහැකි වුණා."
      );

      return;
    }

    const sent = await safeSendMessage(sock, jid, {
      text: `🎬 *${kind.toUpperCase()} MOVIES*\n\n${formatSearchResults(results)}`
    });

    const id = sent?.key?.id;

    if (id) {
      setPendingSelection(
        jid,
        id,
        `movie:${kind}`,
        1,
        results
      );
    }
  } catch (error) {
    console.error(
      `[Discover] ${kind} failed:`,
      error
    );

    await safeSendText(
      sock,
      jid,
      "TMDB සේවාවෙන් Movies ලබාගැනීමට නොහැකි වුණා."
    );
  }
}

// --------------------------------------------------
// FAVORITES / WATCHLIST
// --------------------------------------------------

async function showLibrary(
  sock: WASocket,
  jid: string,
  list: "favorite" | "watchlist"
) {
  try {
    const items = await listLibrary(jid, list);

    if (!items.length) {
      await safeSendText(
        sock,
        jid,
        list === "favorite"
          ? "⭐ Favorite list එක හිස්.\n`.fav add Movie Name` භාවිතා කරන්න."
          : "📌 Watchlist එක හිස්.\n`.watchlist add Movie Name` භාවිතා කරන්න."
      );

      return;
    }

    const lines = [
      `╭─「 ${list === "favorite" ? "⭐ FAVORITES" : "📌 WATCHLIST"} 」`,
      "│"
    ];

    items.forEach((item: any, i: number) => {
      lines.push(
        `│ ${i + 1}. *${item.title}*${item.release_year ? ` (${item.release_year})` : ""}\n│    ⭐ ${item.rating || "N/A"}/10`
      );
    });

    lines.push(
      "│",
      "╰──────────────●●►"
    );

    await safeSendText(
      sock,
      jid,
      lines.join("\n")
    );
  } catch (error) {
    console.error(
      "[Library] Read failed:",
      error
    );

    await safeSendText(
      sock,
      jid,
      "Favorites/Watchlist භාවිතා කිරීමට Supabase migration එක ක්‍රියාත්මක කරන්න."
    );
  }
}

async function changeLibrary(
  sock: WASocket,
  jid: string,
  list: "favorite" | "watchlist",
  args: string
) {
  const [action = "list", ...parts] =
    args.trim().split(/\s+/);

  const query = parts.join(" ").trim();

  if (action === "list") {
    await showLibrary(sock, jid, list);
    return;
  }

  if (!query) {
    await safeSendText(
      sock,
      jid,
      `භාවිතය: .${list === "favorite" ? "fav" : "watchlist"} add/remove <movie name>`
    );

    return;
  }

  try {
    if (action === "remove") {
      await removeLibraryItem(jid, list, query);

      await safeSendText(
        sock,
        jid,
        "List එකෙන් ඉවත් කළා."
      );

      return;
    }

    if (action !== "add") {
      await safeSendText(
        sock,
        jid,
        "add, remove හෝ list භාවිතා කරන්න."
      );

      return;
    }

    const found =
      /^tt\d{5,12}$/i.test(query)
        ? await mediaProvider.getByImdbId(query)
        : (await mediaProvider.search(query, 1))[0] || null;

    if (!found) {
      await safeSendText(
        sock,
        jid,
        "Movie එක හමු වුණේ නැහැ."
      );

      return;
    }

    await saveLibraryItem(jid, list, found);

    await safeSendText(
      sock,
      jid,
      `${list === "favorite" ? "⭐ Favorite" : "📌 Watchlist"} එකට එකතු කළා: *${found.title}*`
    );
  } catch (error) {
    console.error(
      "[Library] Update failed:",
      error
    );

    await safeSendText(
      sock,
      jid,
      "List එක update කිරීමට නොහැකි වුණා. Supabase setup එක පරීක්ෂා කරන්න."
    );
  }
}

// --------------------------------------------------
// HANDLE SEARCH RESULT REPLIES
// --------------------------------------------------

async function selectReply(
  sock: WASocket,
  jid: string,
  quotedId: string,
  answer: string
) {
  const session = getPendingSelection(
    jid,
    quotedId
  );

  if (!session) return;

  const value = answer.trim().toUpperCase();

  const [type, query] =
    session.query.split(/:(.*)/s);

  if (value === "A") {
    if (type === "discover") {
      const next = await mediaProvider.discover(
        query as "popular" | "trending" | "top" | "upcoming",
        session.page + 1
      );

      if (!next.length) {
        await safeSendText(
          sock,
          jid,
          "තවත් Search Results නැහැ."
        );

        return;
      }

      const sent = await safeSendMessage(sock, jid, {
        text: `🎬 *${query.toUpperCase()} MOVIES*\n\n${formatSearchResults(next)}`
      });

      const id = sent?.key?.id;

      if (id) {
        setPendingSelection(
          jid,
          id,
          `discover:${query}`,
          session.page + 1,
          next
        );
      }

      return;
    }

    await sendPage(
      sock,
      jid,
      query,
      session.page + 1,
      type === "tv" ? "tv" : "movie"
    );

    return;
  }

  if (!/^\d{1,2}$/.test(value)) return;

  const selected =
    session.results[Number(value) - 1];

  if (!selected) {
    await safeSendText(
      sock,
      jid,
      "වැරදි අංකයක්. List එකේ අංකයක් Reply කරන්න."
    );

    return;
  }

  try {
    const details =
      selected.mediaType === "tv"
        ? await mediaProvider.getTvDetails(selected.id)
        : await mediaProvider.getDetails(selected.id);

    if (!details) {
      await safeSendText(
        sock,
        jid,
        "Details ලබාගැනීමට නොහැකි වුණා."
      );

      return;
    }

    clearPendingSelection(jid);

    await sendDetails(sock, jid, details);
  } catch (error) {
    console.error(
      "[Details] Failed:",
      error
    );

    await safeSendText(
      sock,
      jid,
      "Details ලබාගැනීමේදී දෝෂයක් ඇතිවුණා."
    );
  }
}

// --------------------------------------------------
// MAIN MESSAGE HANDLER
// --------------------------------------------------

export async function handleMessage(
  sock: WASocket,
  jid: string,
  text: string,
  quotedMessageId?: string
): Promise<void> {
  const message = text.trim();

  if (!message) return;

  if (!message.startsWith(".")) {
    if (await isOptedOut(jid)) return;

    if (
      quotedMessageId &&
      (/^A$/i.test(message) || /^\d{1,2}$/.test(message))
    ) {
      await selectReply(
        sock,
        jid,
        quotedMessageId,
        message
      );
    }

    return;
  }

  const line = message.slice(1).trim();

  if (!line) return;

  const [rawCommand, ...args] =
    line.split(/\s+/);

  const command = rawCommand.toLowerCase();

  const argument = args.join(" ").trim();

  if (await handleConsentCommand(sock, jid, line)) {
    return;
  }

  if (await isOptedOut(jid)) return;

  const maintenance = await getBotSetting("maintenance");

  if (
    maintenance === "on" &&
    !["status", "ping", "about", "help", "menu", "jid"].includes(command)
  ) {
    await safeSendText(
      sock,
      jid,
      "🛠️ Bot එක Maintenance Mode එකේ. ටික වේලාවකින් නැවත උත්සාහ කරන්න."
    );

    return;
  }

  // ------------------------------------------------
  // COMMAND ROUTER
  // ------------------------------------------------

  switch (command) {
    case "help":
    case "menu": {
      await safeSendText(sock, jid, HELP);
      return;
    }

    // ----------------------------------------------
    // WHATSAPP JID
    // ----------------------------------------------

    case "jid": {
      await safeSendText(
        sock,
        jid,
        [
          "╭─「 ᴡʜᴀᴛꜱᴀᴘᴘ ɪᴅ 」",
          "│",
          "│ 👤 *Your JID:*",
          `│ \`${jid}\``,
          "│",
          "╰──────────────●●►",
          "",
          "📌 Use this JID for OWNER_JID configuration."
        ].join("\n")
      );

      return;
    }

    // ----------------------------------------------
    // MOVIE SEARCH
    // ----------------------------------------------

    case "mv":
    case "movie": {
      await runSearch(
        sock,
        jid,
        argument,
        "movie"
      );

      return;
    }

    // ----------------------------------------------
    // TV SEARCH
    // ----------------------------------------------

    case "tv": {
      await runSearch(
        sock,
        jid,
        argument,
        "tv"
      );

      return;
    }

    // ----------------------------------------------
    // IMDb SEARCH
    // ----------------------------------------------

    case "id": {
      const found =
        await mediaProvider.getByImdbId(argument);

      if (!found) {
        await safeSendText(
          sock,
          jid,
          "IMDb ID එකෙන් Movie/Series එකක් හමු වුණේ නැහැ."
        );

        return;
      }

      await sendDetails(
        sock,
        jid,
        found
      );

      return;
    }

    // ----------------------------------------------
    // DISCOVERY
    // ----------------------------------------------

    case "popular":
    case "trending":
    case "top":
    case "upcoming": {
      await discover(
        sock,
        jid,
        command
      );

      return;
    }

    // ----------------------------------------------
    // FAVORITES
    // ----------------------------------------------

    case "fav": {
      await changeLibrary(
        sock,
        jid,
        "favorite",
        argument || "list"
      );

      return;
    }

    // ----------------------------------------------
    // WATCHLIST
    // ----------------------------------------------

    case "watchlist": {
      await changeLibrary(
        sock,
        jid,
        "watchlist",
        argument || "list"
      );

      return;
    }

    // ----------------------------------------------
    // ADMIN SETTINGS
    // ----------------------------------------------

    case "settings": {
      await handleSettings(
        sock,
        jid,
        argument
      );

      return;
    }

    // ----------------------------------------------
    // BOT STATUS
    // ----------------------------------------------

    case "status": {
      await safeSendText(
        sock,
        jid,
        [
          "🟢 *J.A.R.V.I.S. STATUS*",
          "",
          "WhatsApp: Connected",
          "Movie metadata: TMDB",
          "Movie Search: Available",
          "TV Search: Available",
          "Favorites/Watchlist: Supabase",
          "File delivery: Not configured"
        ].join("\n")
      );

      return;
    }

    // ----------------------------------------------
    // PING
    // ----------------------------------------------

    case "ping": {
      const start = performance.now();

      await safeSendText(
        sock,
        jid,
        `🏓 Pong!\nResponse: ${Math.round(performance.now() - start)} ms`
      );

      return;
    }

    // ----------------------------------------------
    // ABOUT
    // ----------------------------------------------

    case "about": {
      await safeSendText(
        sock,
        jid,
        [
          "🤖 *J.A.R.V.I.S. MOVIE BOT*",
          "",
          "Movie & TV metadata assistant powered by TMDB.",
          "WhatsApp: Baileys",
          "Database: Supabase",
          "Media downloads: Not enabled (authorized provider required).",
          "",
          "Use `.menu` to view commands."
        ].join("\n")
      );

      return;
    }

    // ----------------------------------------------
    // UNKNOWN COMMAND
    // ----------------------------------------------

    default: {
      await safeSendText(
        sock,
        jid,
        "Command එක හඳුනාගන්න බැහැ. `.menu` යවන්න."
      );

      return;
    }
  }
}
