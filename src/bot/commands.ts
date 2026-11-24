import type { WASocket } from "@whiskeysockets/baileys";

import { mediaProvider } from "../services/media-provider";
import { setResults, getResults } from "./state";
import { recordSearch } from "../database/supabase";

import {
  handleConsentCommand,
  isWithinInboundLimit,
  safeSendText
} from "./safety";

const HELP = [
  "🎬 *J.A.R.V.I.S. Movie Bot*",
  "",
  "Movie title එකක් හෝ IMDb ID එකක් යවන්න.",
  "Search results වලින් අංකයක් තෝරන්න.",
  "",
  "Commands:",
  "*help* - Help",
  "*STOP* - Bot replies නවත්වන්න",
  "*START* - Bot නැවත සක්‍රීය කරන්න"
].join("\n");

function formatMovie(
  movie: {
    title: string;
    year?: number;
    rating?: string;
    ageRating?: string;
    overview?: string;
  },
  index: number
) {
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

export async function handleMessage(
  sock: WASocket,
  jid: string,
  text: string
): Promise<void> {
  const message = text.trim();

  if (!message) return;

  // Consent commands must work even when normal rate limit is reached.
  const consentHandled = await handleConsentCommand(
    sock,
    jid,
    message
  );

  if (consentHandled) return;

  // Ignore excessive inbound requests.
  if (!isWithinInboundLimit(jid)) {
    return;
  }

  if (/^(help|menu)$/i.test(message)) {
    await safeSendText(sock, jid, HELP);
    return;
  }

  if (/^\d+$/.test(message)) {
    const index = Number(message) - 1;
    const results = getResults(jid);
    const selected = results[index];

    if (!selected) {
      await safeSendText(
        sock,
        jid,
        "අංකය වලංගු නැහැ. නැවත movie title එකක් යවන්න."
      );

      return;
    }

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

    const response = [
      "🎬 *MOVIE DETAILS*",
      "",
      `*Title:* ${details.title}`,
      `*Year:* ${details.year || "Unknown"}`,
      `*Rating:* ${details.rating || "N/A"}/10`,
      `*Age rating:* ${details.ageRating || "Not rated"}`,
      `*Runtime:* ${details.runtime ? `${details.runtime} minutes` : "Unknown"}`,
      `*Genres:* ${details.genres?.join(", ") || "Unknown"}`,
      "",
      "*Overview:*",
      details.overview || "No overview available.",
      "",
      `*TMDB:* ${details.sourceUrl || "Unavailable"}`,
      "",
      "Media delivery දැනට configure කර නැහැ."
    ].join("\n");

    await safeSendText(sock, jid, response);
    return;
  }

  try {
    await safeSendText(
      sock,
      jid,
      "🔎 Movie එක සොයමින්..."
    );

    const results = await mediaProvider.search(message);

    await recordSearch({
      jid,
      query: message,
      resultCount: results.length
    });

    if (!results.length) {
      await safeSendText(
        sock,
        jid,
        "Movie එකක් හමු වුණේ නැහැ. නම හෝ IMDb ID එක නැවත පරීක්ෂා කරන්න."
      );

      return;
    }

    setResults(jid, results);

    await safeSendText(
      sock,
      jid,
      "🎬 *MOVIE SEARCH RESULTS*\n\n" +
      results
        .map(formatMovie)
        .join("\n\n") +
      "\n\nMovie එකක් තෝරන්න: අදාළ අංකය යවන්න."
    );

  } catch (error) {
    console.error("[Bot] Movie search failed:", error);

    await safeSendText(
      sock,
      jid,
      "Movie search එකේ දෝෂයක් ඇතිවුණා. පසුව නැවත උත්සාහ කරන්න."
    );
  }
}
