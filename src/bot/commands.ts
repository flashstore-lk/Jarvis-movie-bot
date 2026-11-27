
import type { WASocket } from "@whiskeysockets/baileys";

import { mediaProvider } from "../services/media-provider";

import {
  setPendingSelection,
  getPendingSelection,
  clearPendingSelection
} from "./state";

import { recordSearch } from "../database/supabase";

import {
  handleConsentCommand,
  isOptedOut,
  safeSendMessage,
  safeSendText
} from "./safety";

import type { MovieResult } from "../services/types";

const HELP = [
  "🎬 *J.A.R.V.I.S. MOVIE BOT*",
  "",
  "*Movie Search*",
  ".mv Deadpool",
  ".mv tt1431045",
  ".mv Deadpool/tt1431045",
  "",
  "*Movie Selection*",
  "Search Results message එකට Reply කරලා number එක යවන්න.",
  "ඊළඟ Movies 10 ලබාගැනීමට A යවන්න.",
  "",
  "*Other Commands*",
  ".help - Commands list",
  ".status - Bot status",
  ".stop - Stop bot replies",
  ".start - Enable bot again",
  "",
  "Movie නමක් හෝ IMDb ID එකක් ඇතුළත් කරන්න."
].join("\n");

function shorten(
  value: string,
  maxLength: number
): string {
  const clean = value
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, maxLength - 1).trim()}…`;
}

function formatSearchResults(
  movies: MovieResult[],
  page: number
): string {
  const lines: string[] = [
    "╭─「 ꜱᴇᴀʀᴄʜ ʀᴇꜱᴜʟᴛꜱ 」",
    "│"
  ];

  movies.forEach((movie, index) => {
    const title = movie.title
      .replace(/`/g, "'")
      .replace(/\n/g, " ")
      .trim();

    const displayTitle = movie.year
      ? `${title} (${movie.year})`
      : title;

    const rating = movie.rating
      ? `${movie.rating}/10`
      : "Not available";

    const ageRating = movie.ageRating || "Not rated";

    lines.push(
      `│ 🎬 ${index + 1} ☞ \`${displayTitle}\``
    );

    lines.push(
      `│    ⭐ ${rating} | 🔞 ${ageRating}`
    );

    const overview = shorten(
      movie.overview || "No overview available.",
      125
    );

    lines.push(
      `│    📝 ${overview}`
    );

    if (index !== movies.length - 1) {
      lines.push("│");
    }
  });

  lines.push("");
  lines.push("╰──────────────●●►");
  lines.push("");
  lines.push(
    "📌 *Reply with the number to see details.*"
  );

  if (movies.length === 10) {
    lines.push("");
    lines.push("*A - More....*");
  }

  lines.push("");
  lines.push(
    `> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴍᴏᴠɪᴇ ʜᴜʙ </>`
  );

  return lines.join("\n");
}

function formatMovieDetails(
  movie: MovieResult
): string {
  const rating = movie.rating
    ? `${movie.rating}/10`
    : "Unavailable";

  return [
    `🎬 *${movie.title}${movie.year ? ` (${movie.year})` : ""}*`,
    "",
    `│ 🎟️ *YEAR:* \`${movie.year || "Unknown"}\``,
    `│ 🆔 *IMDb ID:* \`${movie.imdbId || "Unavailable"}\``,
    `│ ⭐ *TMDB RATING:* \`${rating}\``,
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

async function sendMovieDetails(
  sock: WASocket,
  jid: string,
  movie: MovieResult
): Promise<void> {
  const caption = formatMovieDetails(movie);

  if (movie.posterUrl) {
    try {
      await safeSendMessage(
        sock,
        jid,
        {
          image: {
            url: movie.posterUrl
          },
          caption
        }
      );

      return;
    } catch (error) {
      console.error(
        "[Bot] Poster delivery failed:",
        error instanceof Error
          ? error.message
          : "Unknown error"
      );
    }
  }

  await safeSendText(
    sock,
    jid,
    `${caption}\n\n🖼️ Poster image unavailable.`
  );
}

async function sendSearchPage(
  sock: WASocket,
  jid: string,
  query: string,
  page: number
): Promise<void> {
  const results = await mediaProvider.search(
    query,
    page
  );

  if (!results.length) {
    await safeSendText(
      sock,
      jid,
      page === 1
        ? "Movie එකක් හමු වුණේ නැහැ. Movie නම හෝ IMDb ID එක පරීක්ෂා කරන්න."
        : "තවත් Search Results නැහැ. මේ search එකේ අවසාන පිටුවට පැමිණ තිබෙනවා."
    );

    return;
  }

  const sent = await safeSendMessage(
    sock,
    jid,
    {
      text: formatSearchResults(results, page)
    }
  );

  const messageId = sent?.key?.id;

  if (!messageId) {
    await safeSendText(
      sock,
      jid,
      "Search Results message ID එක ලබාගැනීමට නොහැකි වුණා. නැවත search කරන්න."
    );

    return;
  }

  setPendingSelection(
    jid,
    messageId,
    query,
    page,
    results
  );
}

async function searchMovie(
  sock: WASocket,
  jid: string,
  query: string
): Promise<void> {
  const cleanQuery = query.trim().slice(0, 100);

  if (!cleanQuery) {
    await safeSendText(
      sock,
      jid,
      [
        "Movie නමක් හෝ IMDb ID එකක් ඇතුළත් කරන්න.",
        "",
        "උදාහරණ:",
        ".mv Avengers",
        ".mv tt1431045",
        ".mv Deadpool/tt1431045"
      ].join("\n")
    );

    return;
  }

  try {
    const slashIndex = cleanQuery.lastIndexOf("/");

    const imdbCandidate = slashIndex >= 0
      ? cleanQuery.slice(slashIndex + 1).trim()
      : "";

    const combinedMatch =
      /^tt\d{5,12}$/i.test(imdbCandidate);

    const searchTerm = combinedMatch
      ? imdbCandidate
      : cleanQuery;

    await safeSendText(
      sock,
      jid,
      "🔎 Movie එක සොයමින්..."
    );

    const results = await mediaProvider.search(
      searchTerm,
      1
    );

    await recordSearch({
      jid,
      query: cleanQuery,
      resultCount: results.length
    });

    if (!results.length) {
      await safeSendText(
        sock,
        jid,
        "Movie එකක් හමු වුණේ නැහැ. Movie නම හෝ IMDb ID එක පරීක්ෂා කරන්න."
      );

      return;
    }

    if (combinedMatch) {
      const details = await mediaProvider.getDetails(
        results[0].id
      );

      if (!details) {
        await safeSendText(
          sock,
          jid,
          "Movie details ලබාගැනීමට නොහැකි වුණා."
        );

        return;
      }

      await sendMovieDetails(sock, jid, details);
      return;
    }

    await sendSearchPage(
      sock,
      jid,
      searchTerm,
      1
    );

  } catch (error) {
    console.error(
      "[Bot] Movie search failed:",
      error instanceof Error
        ? error.message
        : "Unknown error"
    );

    await safeSendText(
      sock,
      jid,
      "Movie search එකේ දෝෂයක් ඇතිවුණා. පසුව නැවත උත්සාහ කරන්න."
    );
  }
}

async function selectMovieByReply(
  sock: WASocket,
  jid: string,
  quotedMessageId: string,
  answer: string
): Promise<void> {
  const session = getPendingSelection(
    jid,
    quotedMessageId
  );

  if (!session) return;

  const normalizedAnswer = answer.trim().toUpperCase();

  // A = next page
  if (normalizedAnswer === "A") {
    try {
      await safeSendText(
        sock,
        jid,
        "⏳ ඊළඟ Movies සොයමින්..."
      );

      await sendSearchPage(
        sock,
        jid,
        session.query,
        session.page + 1
      );
    } catch (error) {
      console.error(
        "[Bot] Next page failed:",
        error instanceof Error
          ? error.message
          : "Unknown error"
      );

      await safeSendText(
        sock,
        jid,
        "ඊළඟ Search Results ලබාගැනීමේදී දෝෂයක් ඇතිවුණා."
      );
    }

    return;
  }

  if (!/^\d{1,2}$/.test(normalizedAnswer)) {
    return;
  }

  const index = Number(normalizedAnswer) - 1;
  const selected = session.results[index];

  if (!selected) {
    await safeSendText(
      sock,
      jid,
      "❌ වැරදි අංකයක්. Search Results list එකේ ඇති අංකයක් Reply කරන්න."
    );

    return;
  }

  try {
    await safeSendText(
      sock,
      jid,
      "⏳ Movie details ලබාගනිමින්..."
    );

    const details = await mediaProvider.getDetails(
      selected.id
    );

    if (!details) {
      await safeSendText(
        sock,
        jid,
        "Movie details ලබාගැනීමට නොහැකි වුණා."
      );

      return;
    }

    clearPendingSelection(jid);

    await sendMovieDetails(
      sock,
      jid,
      details
    );
  } catch (error) {
    console.error(
      "[Bot] Movie details failed:",
      error instanceof Error
        ? error.message
        : "Unknown error"
    );

    await safeSendText(
      sock,
      jid,
      "Movie details ලබාගැනීමේදී දෝෂයක් ඇතිවුණා."
    );
  }
}

export async function handleMessage(
  sock: WASocket,
  jid: string,
  text: string,
  quotedMessageId?: string
): Promise<void> {
  const message = text.trim();

  if (!message) return;

  // Replies to Search Results messages.
  if (!message.startsWith(".")) {
    if (await isOptedOut(jid)) return;

    if (
      quotedMessageId &&
      (
        /^A$/i.test(message) ||
        /^\d{1,2}$/.test(message)
      )
    ) {
      await selectMovieByReply(
        sock,
        jid,
        quotedMessageId,
        message
      );
    }

    return;
  }

  const commandLine = message.slice(1).trim();

  if (!commandLine) return;

  const firstSpace = commandLine.indexOf(" ");

  const command = (
    firstSpace === -1
      ? commandLine
      : commandLine.slice(0, firstSpace)
  ).toLowerCase();

  const argument = firstSpace === -1
    ? ""
    : commandLine.slice(firstSpace + 1).trim();

  const consentHandled = await handleConsentCommand(
    sock,
    jid,
    commandLine
  );

  if (consentHandled) return;

  if (await isOptedOut(jid)) return;

  switch (command) {
    case "help":
    case "menu": {
      await safeSendText(sock, jid, HELP);
      return;
    }

    case "mv":
    case "movie": {
      await searchMovie(sock, jid, argument);
      return;
    }

    case "status": {
      await safeSendText(
        sock,
        jid,
        [
          "🟢 *J.A.R.V.I.S. STATUS*",
          "",
          "Movie metadata: TMDB",
          "Search: Available",
          "Movie details: Available",
          "Search pagination: Available",
          "File delivery: Not configured",
          "",
          "Commands: `.help`"
        ].join("\n")
      );

      return;
    }

    default: {
      await safeSendText(
        sock,
        jid,
        "Command එක හඳුනාගන්න බැහැ.\nCommands බලන්න `.help` යවන්න."
      );

      return;
    }
  }
}
