import type { WASocket } from '@whiskeysockets/baileys';
import { mediaProvider, isAllowedForTeenAudience } from '../services/media-provider.js';
import { recordSearch } from '../database/supabase.js';
import { clearPending, getPending, setPending } from './state.js';

const expiry = () => Date.now() + 5 * 60 * 1000;

export async function handleText(sock: WASocket, jid: string, text: string) {
  const body = text.trim();
  if (!body) return;

  if (body.toLowerCase() === 'help') {
    await sock.sendMessage(jid, { text: 'Movie Assistant\\nSend a movie title or IMDb ID to search.\\nReply with a result number to view details.\\nThis bot only supports titles available through an authorized media provider.' });
    return;
  }

  const pending = getPending(jid);
  if (pending && /^\\d+$/.test(body)) {
    const n = Number(body);
    if (pending.kind === 'movie-list') {
      const selected = pending.items[n - 1];
      if (!selected) {
        await sock.sendMessage(jid, { text: 'Invalid selection. Please send a number from the list.' });
        return;
      }
      try {
        const details = await mediaProvider.details(selected);
        if (!isAllowedForTeenAudience(details)) {
          clearPending(jid);
          await sock.sendMessage(jid, { text: 'This title is not available in this bot.' });
          return;
        }
        setPending(jid, { kind: 'quality-list', movie: details, expiresAt: expiry() });
        const qualities = details.qualities.map((q, i) => `${i + 1}. ${q.label}${q.size ? ` • ${q.size}` : ''}`).join('\\n');
        await sock.sendMessage(jid, { text: `*${details.title}* (${details.year ?? 'Year unknown'})\\nIMDb: ${details.imdbId ?? 'N/A'}\\n${details.overview ?? ''}\\n\\nAvailable options:\\n${qualities}\\n\\nReply with a number to request an authorized file.` });
      } catch {
        await sock.sendMessage(jid, { text: 'Movie details are temporarily unavailable. Please try again later.' });
      }
      return;
    }
    if (pending.kind === 'quality-list') {
      const selected = pending.movie.qualities[n - 1];
      if (!selected) {
        await sock.sendMessage(jid, { text: 'Invalid quality selection. Please choose a listed number.' });
        return;
      }
      try {
        const delivery = await mediaProvider.createDelivery(selected.providerFileId);
        clearPending(jid);
        await sock.sendMessage(jid, { text: `Your authorized ${selected.label} file is ready:\\n${delivery.url}${delivery.expiresAt ? `\\nLink expires: ${delivery.expiresAt}` : ''}` });
      } catch {
        await sock.sendMessage(jid, { text: 'File delivery is not configured for this title yet.' });
      }
      return;
    }
  }

  clearPending(jid);
  try {
    const results = (await mediaProvider.search(body)).filter(isAllowedForTeenAudience).slice(0, 8);
    await recordSearch(jid, body, results.length);
    if (!results.length) {
      await sock.sendMessage(jid, { text: 'No eligible results found, or the authorized media provider is not configured.' });
      return;
    }
    setPending(jid, { kind: 'movie-list', items: results, expiresAt: expiry() });
    const list = results.map((m, i) => `${i + 1}. ${m.title}${m.year ? ` (${m.year})` : ''}${m.rating ? ` • ⭐ ${m.rating}` : ''}`).join('\\n');
    await sock.sendMessage(jid, { text: `*Movie Search Results*\\n\\n${list}\\n\\nReply with a number to view details. Selection expires in 5 minutes.` });
  } catch {
    await sock.sendMessage(jid, { text: 'Movie search is not configured yet. Connect an authorized media provider first.' });
  }
}
