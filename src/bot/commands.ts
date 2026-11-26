
import type { WASocket } from "@whiskeysockets/baileys";

import { mediaProvider } from "../services/media-provider";
import { setResults, getResults } from "./state";
import { recordSearch } from "../database/supabase";

import {
  handleConsentCommand,
  isOptedOut,
  isWithinInboundLimit,
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
  "*Other Commands*",
  ".help - Commands list",
  ".select 1 - Select movie result",
  ".stop - Stop bot replies",
  ".start - Enable bot again",
  "",
  "⚠️ Commands සියල්ල . prefix එකෙන් පටන් ගන්න ඕන."
].join("\n");

function formatMovie(
  movie: MovieResult,
  index: number
): string {
  const year = movie.year
    ? ` (${movie.year})`
    : "";

  const rating = movie.rating
    ? `⭐ ${movie.rating}/10`
    : "Rating unavailable";

  const age = movie.ageRating || "Not rated";

  const overview = movie.overview
    ? `\n${movie.overview.slice(0, 220)}`
    : "";

  return [
    `${index + 1}. *${movie.title}${year}*`,
    rating,
    `Age rating: ${age}`,
    overview
  ].filter(Boolean).join("\n");
}

function formatMovieDetails(
  movie: MovieResult
): string {
  const lines = [
    `🎬 *${movie.title}${movie.year ? ` (${movie.year})` : ""}*`,
    "",
    `│ 🎟️ *YEAR:* \`${movie.year || "Unknown"}\``,
    `│ 🆔 *IMDb ID:* \`${movie.imdbId || "Unavailable"}\``,
    `│ ⭐ *TMDB RATING:* \`${movie.rating || "N/A"}/10\``,
    `│ ⏳ *RUNTIME:* \`${movie.runtime ? `${movie.runtime} MIN` : "Unknown"}\``,
    `│ 🌍 *COUNTRY:* \`${movie.countries?.join(", ") || "Unknown"}\``,
    `│ 🎬 *DIRECTOR:* \`${movie.directors?.join(", ") || "Unknown"}\``,
    `│ 🎭 *GENRES:* \`${movie.genres?.join(", ") || "Unknown"}\``,
    `│ 🔞 *AGE RATING:* \`${movie.ageRating || "Not rated"}\``,
    "│",
    "",
    "*OVERVIEW:*",
    movie.overview || "No overview available.",
    "",
    `🔗 *TMDB:* ${movie.sourceUrl || "Unavailable"}`,
    "",
    "© POWERED BY J.A.R.V.I.S."
  ];

  return lines.join("\n");
}

async function sendMovieDetails(
  sock: WASocket,
  jid: string,
  movie: MovieResult
): Promise<void> {
  const caption = formatMovieDetails(movie);

  try {
    if (movie.posterUrl) {
      await sock.sendMessage(jid, {
        image: {
          url: movie.posterUrl
        },
        caption
      });

      return;
    }

    // Fallback if TMDB does not have a poster.
    await safeSendText(
      sock,
      jid,
      caption + "\n\n🖼️ Poster image unavailable."
    );

  } catch (error) {
    console.error(
      "[Bot] Poster delivery failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    // If image delivery fails, send text details.
    await safeSendText(
      sock,
      jid,
      caption + "\n\n🖼️ Poster image could not be delivered."
    );
  }
}

async function searchMovie(
  sock: WASocket,
  jid: string,
  query: string
): Promise<void> {
  if (!query) {
    await safeSendText(
      sock,
      jid,
      "Movie නමක් හෝ IMDb ID එකක් ඇතුළත් කරන්න.\n\nඋදාහරණ:\n.mv Deadpool\n.mv tt1431045\n.mv Deadpool/tt1431045"
    );

    return;
  }

  try {
    // Combined Movie Title + IMDb ID.
    const combinedMatch = query.match(
      /^(.+?)\s*\/\s*(tt\d{5,12})$/i
    );

    if (combinedMatch) {
      const suppliedTitle = combinedMatch[1].trim();
      const imdbId = combinedMatch[2].trim();

      await safeSendText(
        sock,
        jid,
        "🔎 IMDb ID එකෙන් Movie Details ලබාගනිමින්..."
      );

      const results = await mediaProvider.search(imdbId);

      await recordSearch({
        jid,
        query,
        resultCount: results.length
      });

      if (!results.length) {
        await safeSendText(
          sock,
          jid,
          `Movie එක හමු වුණේ නැහැ.\nIMDb ID: ${imdbId}`
        );

        return;
      }

      const selected = results[0];

      const details = await mediaProvider.getDetails(
        selected.id
      );

      if (!details) {
        await safeSendText(
          sock,
          jid,
          "Movie Details ලබාගැනීමට නොහැකි වුණා."
        );

        return;
      }

      console.log(
        `[Bot] Direct movie lookup: ${suppliedTitle} -> ${details.title}`
      );

      await sendMovieDetails(
        sock,
        jid,
        details
      );

      return;
    }

    await safeSendText(
      sock,
      jid,
      "🔎 Movie එක සොයමින්..."
    );

    const results = await mediaProvider.search(query);

    await recordSearch({
      jid,
      query,
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

    setResults(jid, results);

    await safeSendText(
      sock,
      jid,
      "🎬 *MOVIE SEARCH RESULTS*\n\n" +
      results.map(formatMovie).join("\n\n") +
      "\n\nMovie එක තෝරන්න:\n`.select 1` වැනි command එකක් යවන්න."
    );

  } catch (error) {
    console.error(
      "[Bot] Movie search failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    await safeSendText(
      sock,
      jid,
      "Movie search එකේ දෝෂයක් ඇතිවුණා. පසුව නැවත උත්සාහ කරන්න."
    );
  }
}

async function selectMovie(
  sock: WASocket,
  jid: string,
  argument: string
): Promise<void> {
  if (!/^\d+$/.test(argument)) {
    await safeSendText(
      sock,
      jid,
      "නිවැරදි result number එකක් යවන්න.\nඋදාහරණ: `.select 1`"
    );

    return;
  }

  const index = Number(argument) - 1;
  const results = getResults(jid);
  const selected = results[index];

  if (!selected) {
    await safeSendText(
      sock,
      jid,
      "අංකය වලංගු නැහැ. `.mv Deadpool` මගින් නැවත search කරන්න."
    );

    return;
  }

  try {
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

    await sendMovieDetails(
      sock,
      jid,
      details
    );

  } catch (error) {
    console.error(
      "[Bot] Movie details failed:",
      error instanceof Error ? error.message : "Unknown error"
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
  text: string
): Promise<void> {
  const message = text.trim();

  if (!message) return;

  if (!message.startsWith(".")) {
    if (await isOptedOut(jid)) {
      return;
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

  if (await isOptedOut(jid)) {
    return;
  }

  if (!isWithinInboundLimit(jid)) {
    return;
  }

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

    case "select": {
      await selectMovie(sock, jid, argument);
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
