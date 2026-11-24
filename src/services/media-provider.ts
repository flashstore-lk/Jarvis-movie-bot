import type { AuthorizedMediaProvider, MovieDetails, MovieSearchItem } from './types.js';

/**
 * Intentionally disabled until a provider and per-title distribution rights
 * are verified. Implement this interface only for media you own or are
 * explicitly licensed to distribute. Do not place signed URLs in logs/DB.
 */
export class DisabledMediaProvider implements AuthorizedMediaProvider {
  async search(_query: string): Promise<MovieSearchItem[]> {
    throw new Error('No authorized media provider is configured.');
  }
  async details(_movie: MovieSearchItem): Promise<MovieDetails> {
    throw new Error('No authorized media provider is configured.');
  }
  async createDelivery(_fileId: string): Promise<{ url: string }> {
    throw new Error('No authorized media provider is configured.');
  }
}

export const mediaProvider: AuthorizedMediaProvider = new DisabledMediaProvider();

export function isAllowedForTeenAudience(item: MovieSearchItem): boolean {
  const rating = (item.ageRating ?? '').toLowerCase();
  return !['18+', 'r', 'nc-17', 'tv-ma'].includes(rating);
}
