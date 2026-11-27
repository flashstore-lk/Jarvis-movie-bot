
import type {
  MediaProvider,
  MovieResult
} from "./types";

import { env } from "../config/env";

const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";

const RESULTS_PER_PAGE = 10;
const MAX_TMDB_PAGES = 500;

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
  genres?: Array<{ name: string }>;
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
  page: number;
  total_pages: number;
  total_results: number;
}

interface TMDBFindResponse {
  movie_results?: TMDBMovie[];
}

function getYear(date?: string): number | undefined {
  if (!date) return undefined;

  const year = Number(date.slice(0, 4));

  return Number.isFinite(year) && year > 1800
    ? year
    : undefined;
}

function getCertification(details: TMDBDetails): string {
  const countries = details.release_dates?.results || [];

  const us = countries.find(
    item => item.iso_3166_1 === "US"
  );

  const certification = us?.release_dates?.find(
    item => item.certification?.trim()
  )?.certification;

  return certification || "Not rated";
}

async function tmdbRequest<T>(
  endpoint: string,
  params: Record<string, string> = {}
): Promise<T> {
  if (!env.tmdbApiKey) {
    throw new Error("TMDB_API_KEY is not configured.");
  }

  const url = new URL(`${BASE_URL}${endpoint}`);

  url.searchParams.set("api_key", env.tmdbApiKey);
  url.searchParams.set("language", "en-US");

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

  if (details.adult) return null;

  const directors = details.credits?.crew
    ?.filter(person => person.job === "Director")
    .map(person => person.name) || [];

  return {
    id: String(details.id),
    title: details.title,
    year: getYear(details.release_date),
    overview: details.overview || "",
    rating:
      typeof details.vote_average === "number"
        ? details.vote_average.toFixed(1)
        : undefined,
    ageRating: getCertification(details),
    runtime: details.runtime,
    genres: details.genres?.map(
      genre => genre.name
    ) || [],
    imdbId: details.external_ids?.imdb_id || undefined,
    posterUrl: details.poster_path
      ? `${IMAGE_BASE_URL}${details.poster_path}`
      : undefined,
    countries: details.production_countries?.map(
      country => country.name
    ) || [],
    directors,
    sourceUrl:
      `https://www.themoviedb.org/movie/${details.id}`
  };
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function rankResults(
  query: string,
  movies: MovieResult[]
): MovieResult[] {
  const normalizedQuery = normalizeTitle(query);

  if (
    !normalizedQuery ||
    /^tt\d{5,12}$/i.test(query)
  ) {
    return movies;
  }

  const queryWords = new Set(
    normalizedQuery.split(" ")
  );

  return [...movies].sort((a, b) => {
    const score = (movie: MovieResult) => {
      const title = normalizeTitle(movie.title);
      let value = 0;

      if (title === normalizedQuery) {
        value += 1000;
      } else if (title.startsWith(normalizedQuery)) {
        value += 500;
      } else if (title.includes(normalizedQuery)) {
        value += 300;
      }

      const overlap = title
        .split(" ")
        .filter(word => queryWords.has(word)).length;

      value += overlap * 20;

      const rating = Number(movie.rating);

      if (Number.isFinite(rating)) {
        value += rating;
      }

      return value;
    };

    return score(b) - score(a);
  });
}

export class TMDBMediaProvider implements MediaProvider {
  async search(
    query: string,
    page = 1
  ): Promise<MovieResult[]> {
    const cleanQuery = query.trim();

    if (
      !cleanQuery ||
      cleanQuery.length > 100 ||
      !Number.isInteger(page) ||
      page < 1
    ) {
      return [];
    }

    if (/^tt\d{5,12}$/i.test(cleanQuery)) {
      const response = await tmdbRequest<TMDBFindResponse>(
        `/find/${encodeURIComponent(cleanQuery)}`,
        {
          external_source: "imdb_id"
        }
      );

      const movie = response.movie_results?.find(
        item => !item.adult
      );

      if (!movie) return [];

      const details = await getMovieWithDetails(movie);

      return details ? [details] : [];
    }

    // Each bot page contains 10 results.
    // TMDB returns 20 results per page.
    const tmdbPage = Math.ceil(page / 2);
    const offset = ((page - 1) % 2) * RESULTS_PER_PAGE;

    if (tmdbPage > MAX_TMDB_PAGES) {
      return [];
    }

    const response = await tmdbRequest<TMDBSearchResponse>(
      "/search/movie",
      {
        query: cleanQuery,
        include_adult: "false",
        page: String(tmdbPage)
      }
    );

    const safeMovies = (response.results || [])
      .filter(movie => !movie.adult);

    const selected = safeMovies.slice(
      offset,
      offset + RESULTS_PER_PAGE
    );

    const detailed = await Promise.all(
      selected.map(async movie => {
        try {
          return await getMovieWithDetails(movie);
        } catch (error) {
          console.error(
            `[TMDB] Could not load movie ${movie.id}:`,
            error instanceof Error
              ? error.message
              : "Unknown error"
          );

          return null;
        }
      })
    );

    const valid = detailed.filter(
      (movie): movie is MovieResult => movie !== null
    );

    return rankResults(cleanQuery, valid);
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

  async getAuthorizedLinks(_movieId: string) {
    // No authorized media distributor is configured.
    return [];
  }
}

export const mediaProvider: MediaProvider =
  new TMDBMediaProvider();
