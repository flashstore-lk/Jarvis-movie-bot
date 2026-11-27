
import type { MovieResult } from "../services/types";

export interface PendingSelection {
  messageId: string;
  query: string;
  page: number;
  results: MovieResult[];
  updatedAt: number;
}

const sessions = new Map<string, PendingSelection>();

const SESSION_TTL = 15 * 60 * 1000;

export function setPendingSelection(
  jid: string,
  messageId: string,
  query: string,
  page: number,
  results: MovieResult[]
): void {
  sessions.set(jid, {
    messageId,
    query,
    page,
    results,
    updatedAt: Date.now()
  });
}

export function getPendingSelection(
  jid: string,
  quotedMessageId: string
): PendingSelection | null {
  const session = sessions.get(jid);

  if (!session) return null;

  if (Date.now() - session.updatedAt > SESSION_TTL) {
    sessions.delete(jid);
    return null;
  }

  if (session.messageId !== quotedMessageId) {
    return null;
  }

  return session;
}

export function clearPendingSelection(jid: string): void {
  sessions.delete(jid);
}
