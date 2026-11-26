
import type {
  MediaProvider,
  MovieResult
} from "./types";

import { env } from "../config/env";

const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";

interface TMDBMovie {
  id: number;
  title: string;
  release_date?: string;
  overview?: string;
  vote_average?: number;
  adult?: boolean;
  poster_path?: string | null;
}

interface TMDBDetails extends TMDBMovie {
  runtime?: number;

  genres?: Array<{
    name: string;
  }>;

  production_countries?: Array<{
    name: string;
    iso_3166_1: string;
  }>;

  external_ids?: {
    imdb_id?: string | null;
  };

  credits?: {
    crew?: Array<{
      job: string;
      name: string;
    }>;
  };

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
      append_to_response:
        "release_dates,external_ids,credits"
    }
  );

  // Keep TMDB's explicit adult-content flag protection.
  if (details.adult) return null;

  const directors =
    details.credits?.crew
      ?.filter(person => person.job === "Director")
      .map(person => person.name) || [];

  const posterUrl = details.poster_path
    ? `${IMAGE_BASE_URL}${details.poster_path}`
    : undefined;

  return {
    id: String(details.id),

    title: details.title,

    year: getYear(details.release_date),

    overview: details.overview || "",

    rating: details.vote_average?.toFixed(1),

    ageRating: getCertification(details),

    runtime: details.runtime,

    genres: details.genres?.map(
      genre => genre.name
    ),

    imdbId:
      details.external_ids?.imdb_id || undefined,

    posterUrl,

    countries:
      details.production_countries?.map(
        country => country.name
      ) || [],

    directors,

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
    // No authorized media provider is configured.
    return [];
  }
}

export const mediaProvider: MediaProvider =
  new TMDBMediaProvider();
