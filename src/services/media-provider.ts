
import type {
  MediaProvider,
  MovieResult
} from "./types";

import { env } from "../config/env";

const BASE_URL = "https://api.themoviedb.org/3";

interface TMDBMovie {
  id: number;
  title: string;
  release_date?: string;
  overview?: string;
  vote_average?: number;
  adult?: boolean;
}

interface TMDBDetails extends TMDBMovie {
  runtime?: number;
  genres?: Array<{ name: string }>;
  release_dates?: {
    results?: Array<{
      iso_3166_1: string;
      release_dates?: Array<{
        certification?: string;
      }>;
    }>;
  };
}

interface TMDBSearchResponse {
  results: TMDBMovie[];
}

interface TMDBFindResponse {
  movie_results?: TMDBMovie[];
}

function getYear(date?: string): number | undefined {
  if (!date) return undefined;

  const year = Number(date.slice(0, 4));

  return Number.isFinite(year) ? year : undefined;
}

function getCertification(
  details: TMDBDetails
): string {
  const countries =
    details.release_dates?.results || [];

  const us = countries.find(
    item => item.iso_3166_1 === "US"
  );

  const certification =
    us?.release_dates?.find(
      item => item.certification?.trim()
    )?.certification;

  return certification || "Not rated";
}

function isAllowedByDefault(
  certification: string
): boolean {
  const rating = certification
    .trim()
    .toUpperCase();

  const restricted = [
    "R",
    "NC-17",
    "X",
    "18",
    "18+",
    "18A",
    "TV-MA"
  ];

  return !restricted.includes(rating);
}

async function tmdbRequest<T>(
  endpoint: string,
  params: Record<string, string> = {}
): Promise<T> {
  if (!env.tmdbApiKey) {
    throw new Error(
      "TMDB_API_KEY is not configured."
    );
  }

  const url = new URL(`${BASE_URL}${endpoint}`);

  url.searchParams.set(
    "api_key",
    env.tmdbApiKey
  );

  url.searchParams.set(
    "language",
    "en-US"
  );

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(
      `TMDB request failed: ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}

async function getMovieWithDetails(
  movie: TMDBMovie
): Promise<MovieResult | null> {
  const details = await tmdbRequest<TMDBDetails>(
    `/movie/${movie.id}`,
    {
      append_to_response: "release_dates"
    }
  );

  if (details.adult) return null;

  const ageRating = getCertification(details);

  if (!isAllowedByDefault(ageRating)) {
    return null;
  }

  return {
    id: String(details.id),
    title: details.title,
    year: getYear(details.release_date),
    overview: details.overview || "",
    rating: details.vote_average?.toFixed(1),
    ageRating,
    runtime: details.runtime,
    genres: details.genres?.map(
      genre => genre.name
    ),
    sourceUrl:
      `https://www.themoviedb.org/movie/${details.id}`
  };
}

export class TMDBMediaProvider
  implements MediaProvider {

  async search(
    query: string
  ): Promise<MovieResult[]> {
    const cleanQuery = query.trim();

    if (!cleanQuery) return [];

    let movies: TMDBMovie[] = [];

    if (/^tt\d{5,12}$/i.test(cleanQuery)) {
      const response =
        await tmdbRequest<TMDBFindResponse>(
          `/find/${encodeURIComponent(cleanQuery)}`,
          {
            external_source: "imdb_id"
          }
        );

      movies = response.movie_results || [];
    } else {
      const response =
        await tmdbRequest<TMDBSearchResponse>(
          "/search/movie",
          {
            query: cleanQuery,
            include_adult: "false",
            page: "1"
          }
        );

      movies = response.results || [];
    }

    const selected = movies
      .filter(movie => !movie.adult)
      .slice(0, 8);

    const detailed = await Promise.all(
      selected.map(async movie => {
        try {
          return await getMovieWithDetails(movie);
        } catch (error) {
          console.error(
            `Could not load movie ${movie.id}:`,
            error
          );

          return null;
        }
      })
    );

    return detailed.filter(
      (movie): movie is MovieResult =>
        movie !== null
    );
  }

  async getDetails(
    movieId: string
  ): Promise<MovieResult | null> {
    const id = Number(movieId);

    if (!Number.isInteger(id) || id <= 0) {
      return null;
    }

    const movie = await tmdbRequest<TMDBMovie>(
      `/movie/${id}`
    );

    return getMovieWithDetails(movie);
  }

  async getAuthorizedLinks(
    _movieId: string
  ) {
    // No media distribution provider is configured.
    return [];
  }
}

export const mediaProvider: MediaProvider =
  new TMDBMediaProvider();
