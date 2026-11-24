
import type {
  MediaProvider,
  MovieResult
} from "./types";

/**
 * Provider disabled by default.
 *
 * Connect a metadata or media source only when
 * you have permission to use and distribute it.
 */

export class DisabledMediaProvider
  implements MediaProvider {

  async search(
    _query: string
  ): Promise<MovieResult[]> {
    return [];
  }

  async getAuthorizedLinks(
    _movieId: string
  ) {
    return [];
  }
}

export const mediaProvider: MediaProvider =
  new DisabledMediaProvider();
