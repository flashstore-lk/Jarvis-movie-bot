
import type { MovieResult } from "../services/types";

interface PendingSelection {
  messageId: string;
  results: MovieResult[];
  updatedAt: number;
}

const sessions = new Map<string, PendingSelection>();

const SESSION_TTL = 15 * 60 * 1000;

export function setPendingSelection(
  jid: string,
  messageId: string,
  results: MovieResult[]
): void {
  sessions.set(jid, {
    messageId,
    results,
    updatedAt: Date.now()
  });
}

export function getPendingSelection(
  jid: string,
  quotedMessageId: string
): MovieResult[] {
  const session = sessions.get(jid);

  if (!session) return [];

  if (Date.now() - session.updatedAt > SESSION_TTL) {
    sessions.delete(jid);
    return [];
  }

  if (session.messageId !== quotedMessageId) {
    return [];
  }

  return session.results;
}

export function clearPendingSelection(jid: string): void {
  sessions.delete(jid);
}
