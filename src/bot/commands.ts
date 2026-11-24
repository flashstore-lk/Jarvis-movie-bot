
import type { WASocket } from "@whiskeysockets/baileys";

import { mediaProvider } from "../services/media-provider";
import { setResults, getResults } from "./state";
import { recordSearch } from "../database/supabase";

const HELP = [
  "🎬 *J.A.R.V.I.S. Movie Bot*",
  "",
  "Movie title එකක් හෝ IMDb ID එකක් යවන්න.",
  "Search results ලැබුණොත් අංකයක් යවා තෝරන්න.",
  "",
  "Commands: *help*, *menu*"
].join("\n");

function formatMovie(
  movie: {
    title: string;
    year?: number;
    overview?: string;
  },
  index: number
) {
  const year = movie.year
    ? ` (${movie.year})`
    : "";

  const overview = movie.overview
    ? `\n${movie.overview.slice(0, 240)}`
    : "";

  return `${index + 1}. *${movie.title}${year}*${overview}`;
}

export async function handleMessage(
  sock: WASocket,
  jid: string,
  text: string
) {
  const message = text.trim();

  if (!message) return;

  if (/^(help|menu|start)$/i.test(message)) {
    await sock.sendMessage(jid, {
      text: HELP
    });

    return;
  }

  if (/^\d+$/.test(message)) {
    const index = Number(message) - 1;
    const results = getResults(jid);
    const selected = results[index];

    if (!selected) {
      await sock.sendMessage(jid, {
        text:
          "තෝරාගත් අංකය වලංගු නැහැ. " +
          "අලුතින් movie title එකක් යවන්න."
      });

      return;
    }

    const links =
      await mediaProvider.getAuthorizedLinks(
        selected.id
      );

    if (!links.length) {
      await sock.sendMessage(jid, {
        text:
          `*${selected.title}* තෝරාගත්තා.\n\n` +
          "අවසරලත් media provider එකක් " +
          "සම්බන්ධ කර නැති නිසා links දැනට අක්‍රියයි."
      });

      return;
    }

    await sock.sendMessage(jid, {
      text:
        `*${selected.title}*\n` +
        links
          .map(
            link =>
              `${link.label}: ${link.url}`
          )
          .join("\n")
    });

    return;
  }

  await sock.sendMessage(jid, {
    text: "🔎 සොයමින්..."
  });

  const results =
    await mediaProvider.search(message);

  await recordSearch({
    jid,
    query: message,
    resultCount: results.length
  });

  if (!results.length) {
    await sock.sendMessage(jid, {
      text:
        "Movie search provider එක තවම configure කර නැහැ. " +
        "අවසරලත් metadata API එකක් සම්බන්ධ කළ පසු search ක්‍රියාත්මක කළ හැකියි."
    });

    return;
  }

  setResults(jid, results);

  await sock.sendMessage(jid, {
    text:
      "🎬 *Search results*\n\n" +
      results
        .slice(0, 8)
        .map(formatMovie)
        .join("\n\n")
  });
}
