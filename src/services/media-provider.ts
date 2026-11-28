import type { MediaProvider, MovieResult } from "./types";
import { env } from "../config/env";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const CINE_SUBZ_API = `${env.cinesubzApiBaseUrl}/api/movie/cinesubz`;
const CINESUBZ_HOST = "cinesubz.net";

function isCineSubzMovieUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === CINESUBZ_HOST && url.pathname.startsWith("/movies/");
  } catch {
    return false;
  }
}
const RESULTS_PER_PAGE = 10;

interface TMDBItem {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  vote_average?: number;
  adult?: boolean;
  poster_path?: string | null;
  genre_ids?: number[];
}
interface TMDBResponse { results: TMDBItem[]; total_pages: number; }
interface TMDBDetails extends TMDBItem {
  runtime?: number;
  episode_run_time?: number[];
  genres?: Array<{ name: string }>;
  production_countries?: Array<{ name: string }>;
  origin_country?: string[];
  external_ids?: { imdb_id?: string | null };
  credits?: { crew?: Array<{ job: string; name: string }> };
  release_dates?: { results?: Array<{ iso_3166_1: string; release_dates?: Array<{ certification?: string }> }> };
  content_ratings?: { results?: Array<{ iso_3166_1: string; rating: string }> };
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}
function asString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
}
function yearOf(date?: string) {
  if (!date) return undefined;
  const n = Number(date.slice(0, 4));
  return Number.isFinite(n) && n > 1800 ? n : undefined;
}
function yearFromTitle(title: string): number | undefined {
  const match = title.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}
function numericRating(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const match = raw.match(/\d+(?:\.\d+)?/);
  return match ? match[0] : undefined;
}
function isAdult(value: JsonRecord): boolean {
  if (value.adult === true) return true;
  const badge = asString(value.badge);
  const type = asString(value.type);
  const age = asString(value.ageRating || value.certification);
  return /\b(adult|18\+|xxx|r18)\b/i.test(`${badge} ${type} ${age}`);
}

async function cinesubzRequest<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  if (!env.mochiApiKey) throw new Error("MOCHI_API_KEY is not configured in Railway.");
  const url = new URL(`${CINE_SUBZ_API}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("api_key", env.mochiApiKey);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`CineSubz API request failed (${response.status}).`);
  const body = await response.json() as T;
  const record = asRecord(body);
  if (record.success === false) {
    throw new Error(asString(record.message) || "CineSubz API returned an unsuccessful response.");
  }
  return body;
}

async function tmdbRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  if (!env.tmdbApiKey) throw new Error("TMDB_API_KEY is not configured.");
  const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
  url.searchParams.set("api_key", env.tmdbApiKey);
  url.searchParams.set("language", "en-US");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`TMDB request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

function mapTMDBItem(item: TMDBItem, type: "movie" | "tv" = "movie"): MovieResult {
  const title = type === "tv" ? item.name : item.title;
  const date = type === "tv" ? item.first_air_date : item.release_date;
  return {
    id: String(item.id),
    mediaType: type,
    title: title || "Untitled",
    year: yearOf(date),
    overview: item.overview || "",
    rating: typeof item.vote_average === "number" ? item.vote_average.toFixed(1) : undefined,
    posterUrl: item.poster_path ? `${TMDB_IMAGE_BASE_URL}${item.poster_path}` : undefined,
    sourceUrl: `https://www.themoviedb.org/${type}/${item.id}`,
    sourceProvider: "tmdb"
  };
}

function certification(details: TMDBDetails, type: "movie" | "tv") {
  if (type === "tv") {
    return details.content_ratings?.results?.find(x => x.iso_3166_1 === "US")?.rating || "Not rated";
  }
  const us = details.release_dates?.results?.find(x => x.iso_3166_1 === "US");
  return us?.release_dates?.find(x => x.certification?.trim())?.certification || "Not rated";
}

async function tmdbDetails(id: string, type: "movie" | "tv"): Promise<MovieResult | null> {
  if (!/^\d+$/.test(id)) return null;
  const extra = type === "movie" ? "release_dates,external_ids,credits" : "content_ratings,external_ids,credits";
  const details = await tmdbRequest<TMDBDetails>(`/${type}/${id}`, { append_to_response: extra });
  if (details.adult) return null;
  const base = mapTMDBItem(details, type);
  const directors = details.credits?.crew
    ?.filter(person => person.job === "Director" || (type === "tv" && person.job === "Executive Producer"))
    .map(person => person.name) || [];
  return {
    ...base,
    ageRating: certification(details, type),
    runtime: details.runtime || details.episode_run_time?.[0],
    genres: details.genres?.map(genre => genre.name) || [],
    imdbId: details.external_ids?.imdb_id || undefined,
    countries: details.production_countries?.map(country => country.name) || details.origin_country || [],
    directors
  };
}

function mapCineSubzSearchItem(raw: unknown): MovieResult | null {
  const item = asRecord(raw);
  if (isAdult(item)) return null;
  const title = asString(item.title);
  const sourceUrl = asString(item.url);
  if (!title || !isCineSubzMovieUrl(sourceUrl)) return null;
  const badge = asString(item.badge);
  return {
    id: sourceUrl,
    mediaType: "movie",
    title,
    year: Number(item.year) || yearFromTitle(title),
    rating: numericRating(item.rating),
    sourceBadge: badge || undefined,
    posterUrl: asString(item.image) || undefined,
    sourceUrl,
    sourceProvider: "cinesubz",
    overview: "Open this result to view movie details."
  };
}

function mapCineSubzInfo(raw: unknown, fallbackUrl: string): MovieResult | null {
  const root = asRecord(raw);
  const data = asRecord(root.data);
  const info = Object.keys(data).length ? data : root;
  const title = asString(info.title || info.name);
  if (!title || isAdult(info)) return null;

  const castValue = info.cast;
  const cast = Array.isArray(castValue)
    ? castValue.map(entry => {
        if (typeof entry === "string") return entry;
        const person = asRecord(entry);
        return asString(person.name || person.actor);
      }).filter(Boolean)
    : [];

  const duration = asString(info.duration);
  const runtimeMatch = duration.match(/\d+/);
  const genres = Array.isArray(info.genres)
    ? info.genres.map(entry => typeof entry === "string" ? entry : asString(asRecord(entry).name)).filter(Boolean)
    : [];

  return {
    id: fallbackUrl,
    mediaType: "movie",
    title,
    year: Number(info.year) || yearFromTitle(title),
    overview: asString(info.description),
    rating: numericRating(info.rating),
    ageRating: asString(info.ageRating || info.certification) || undefined,
    sourceBadge: asString(info.quality) || undefined,
    sourceUrl: fallbackUrl,
    sourceProvider: "cinesubz",
    runtime: runtimeMatch ? Number(runtimeMatch[0]) : undefined,
    genres,
    imdbId: asString(info.imdbId) || undefined,
    posterUrl: asString(info.poster || info.image) || undefined,
    countries: asStringArray(info.country ? [info.country] : info.countries),
    directors: asStringArray(info.director ? [info.director] : info.directors),
    cast,
    subtitleBy: asString(info.subtitleBy) || undefined
  };
}

export class CineSubzTMDBMediaProvider implements MediaProvider {
  // Movie search is deliberately CineSubz-only. There is no TMDB fallback here.
  async search(query: string, page = 1): Promise<MovieResult[]> {
    const clean = query.trim();
    if (!clean || clean.length > 100 || !Number.isInteger(page) || page < 1) return [];

    const response = await cinesubzRequest<unknown>("search", {
      q: clean,
      filter: "movie",
      page: String(page)
    });
    const root = asRecord(response);
    const data = asRecord(root.data);
    const rawMovies = Array.isArray(data.movies) ? data.movies : [];
    return rawMovies.map(mapCineSubzSearchItem).filter((movie): movie is MovieResult => Boolean(movie));
  }

  // TV search and discovery remain on TMDB as previously configured.
  async searchTv(query: string, page = 1): Promise<MovieResult[]> {
    const clean = query.trim();
    if (!clean || clean.length > 100 || !Number.isInteger(page) || page < 1) return [];
    return this.searchTMDBType(clean, page, "tv");
  }

  private async searchTMDBType(query: string, page: number, type: "movie" | "tv"): Promise<MovieResult[]> {
    const tmdbPage = Math.ceil(page / 2);
    const offset = ((page - 1) % 2) * RESULTS_PER_PAGE;
    if (tmdbPage > 500) return [];
    const response = await tmdbRequest<TMDBResponse>(`/search/${type}`, {
      query,
      include_adult: "false",
      page: String(tmdbPage)
    });
    return (response.results || [])
      .filter(item => !item.adult)
      .slice(offset, offset + RESULTS_PER_PAGE)
      .map(item => mapTMDBItem(item, type));
  }

  async discover(kind: "popular" | "trending" | "top" | "upcoming", page = 1): Promise<MovieResult[]> {
    if (!Number.isInteger(page) || page < 1 || page > 500) return [];
    let endpoint = "/movie/popular";
    if (kind === "trending") endpoint = "/trending/movie/week";
    if (kind === "top") endpoint = "/movie/top_rated";
    if (kind === "upcoming") endpoint = "/movie/upcoming";
    const response = await tmdbRequest<TMDBResponse>(endpoint, { page: String(page) });
    return (response.results || []).filter(item => !item.adult).slice(0, RESULTS_PER_PAGE).map(item => mapTMDBItem(item));
  }

  async getDetails(movieId: string): Promise<MovieResult | null> {
    if (isCineSubzMovieUrl(movieId)) {
      const response = await cinesubzRequest<unknown>("info", { url: movieId });
      return mapCineSubzInfo(response, movieId);
    }
    return tmdbDetails(movieId, "movie");
  }

  async getTvDetails(tvId: string): Promise<MovieResult | null> {
    return tmdbDetails(tvId, "tv");
  }

  async getByImdbId(imdbId: string): Promise<MovieResult | null> {
    if (!/^tt\d{5,12}$/i.test(imdbId)) return null;
    const found = await tmdbRequest<{ movie_results?: TMDBItem[]; tv_results?: TMDBItem[] }>(
      `/find/${encodeURIComponent(imdbId)}`,
      { external_source: "imdb_id" }
    );
    const movie = found.movie_results?.find(item => !item.adult);
    if (movie) return tmdbDetails(String(movie.id), "movie");
    const tv = found.tv_results?.find(item => !item.adult);
    return tv ? tmdbDetails(String(tv.id), "tv") : null;
  }

  async getAuthorizedLinks(movieUrl: string): Promise<Array<{ label: string; url: string }>> {
    if (!isCineSubzMovieUrl(movieUrl)) return [];
    const response = await cinesubzRequest<unknown>("download", {
      url: movieUrl,
      type: "movie"
    });
    const root = asRecord(response);
    const data = asRecord(root.data);
    if (data.success === false) {
      throw new Error(asString(data.message) || "CineSubz did not return download links.");
    }
    const rawLinks = Array.isArray(data.dl_links)
      ? data.dl_links
      : Array.isArray(data.downloadLinks) ? data.downloadLinks : [];
    return rawLinks.map((raw, index) => {
      const item = asRecord(raw);
      const url = asString(item.url || item.link);
      const type = asString(item.type);
      const id = asString(item.id);
      return {
        label: [type, id && id !== String(index + 1) ? id : ""].filter(Boolean).join(" · ") || `Download ${index + 1}`,
        url
      };
    }).filter(item => /^https:\/\//i.test(item.url)).slice(0, 8);
  }
}

export const mediaProvider: MediaProvider = new CineSubzTMDBMediaProvider();
