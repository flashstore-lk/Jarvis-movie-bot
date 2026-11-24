
import type { MovieResult } from "../services/types";

interface Session {
  results: MovieResult[];
  updatedAt: number;
}

const sessions = new Map<string, Session>();

export function setResults(
  jid: string,
  results: MovieResult[]
) {
  sessions.set(jid, {
    results,
    updatedAt: Date.now()
  });
}

export function getResults(
  jid: string
): MovieResult[] {
  const session = sessions.get(jid);

  if (!session) return [];

  if (
    Date.now() - session.updatedAt >
    15 * 60 * 1000
  ) {
    sessions.delete(jid);
    return [];
  }

  return session.results;
}
