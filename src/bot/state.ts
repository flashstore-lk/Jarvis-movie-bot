type PendingSelection =
  | { kind: 'movie-list'; items: import('../services/types.js').MovieSearchItem[]; expiresAt: number }
  | { kind: 'quality-list'; movie: import('../services/types.js').MovieDetails; expiresAt: number };

const pending = new Map<string, PendingSelection>();

export function setPending(jid: string, value: PendingSelection) {
  pending.set(jid, value);
}
export function getPending(jid: string) {
  const value = pending.get(jid);
  if (!value) return undefined;
  if (value.expiresAt < Date.now()) {
    pending.delete(jid);
    return undefined;
  }
  return value;
}
export function clearPending(jid: string) {
  pending.delete(jid);
}
