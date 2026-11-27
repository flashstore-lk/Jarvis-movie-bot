import type { MediaProvider, MovieResult } from "./types";
import { env } from "../config/env";

const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
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

async function request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  if (!env.tmdbApiKey) throw new Error("TMDB_API_KEY is not configured.");
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set("api_key", env.tmdbApiKey);
  url.searchParams.set("language", "en-US");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`TMDB request failed: ${response.status}`);
  return response.json() as Promise<T>;
}
function yearOf(date?: string) {
  if (!date) return undefined;
  const n = Number(date.slice(0, 4));
  return Number.isFinite(n) && n > 1800 ? n : undefined;
}
function mapItem(item: TMDBItem, type: "movie" | "tv" = "movie"): MovieResult {
  const title = type === "tv" ? item.name : item.title;
  const date = type === "tv" ? item.first_air_date : item.release_date;
  return {
    id: String(item.id), mediaType: type, title: title || "Untitled",
    year: yearOf(date), overview: item.overview || "",
    rating: typeof item.vote_average === "number" ? item.vote_average.toFixed(1) : undefined,
    posterUrl: item.poster_path ? `${IMAGE_BASE_URL}${item.poster_path}` : undefined,
    sourceUrl: `https://www.themoviedb.org/${type}/${item.id}`
  };
}
function certification(d: TMDBDetails, type: "movie" | "tv") {
  if (type === "tv") return d.content_ratings?.results?.find(x => x.iso_3166_1 === "US")?.rating || "Not rated";
  const us = d.release_dates?.results?.find(x => x.iso_3166_1 === "US");
  return us?.release_dates?.find(x => x.certification?.trim())?.certification || "Not rated";
}
async function details(id: string, type: "movie" | "tv"): Promise<MovieResult | null> {
  if (!/^\d+$/.test(id)) return null;
  const extra = type === "movie" ? "release_dates,external_ids,credits" : "content_ratings,external_ids,credits";
  const d = await request<TMDBDetails>(`/${type}/${id}`, { append_to_response: extra });
  if (d.adult) return null;
  const base = mapItem(d, type);
  const directors = d.credits?.crew?.filter(p => p.job === "Director" || (type === "tv" && p.job === "Executive Producer")).map(p => p.name) || [];
  return {
    ...base, ageRating: certification(d, type),
    runtime: d.runtime || d.episode_run_time?.[0],
    genres: d.genres?.map(g => g.name) || [],
    imdbId: d.external_ids?.imdb_id || undefined,
    countries: d.production_countries?.map(c => c.name) || d.origin_country || [],
    directors
  };
}
export class TMDBMediaProvider implements MediaProvider {
  async search(query: string, page = 1): Promise<MovieResult[]> {
    return this.searchType(query, page, "movie");
  }
  async searchTv(query: string, page = 1): Promise<MovieResult[]> {
    return this.searchType(query, page, "tv");
  }
  private async searchType(query: string, page: number, type: "movie" | "tv"): Promise<MovieResult[]> {
    const q = query.trim();
    if (!q || q.length > 100 || !Number.isInteger(page) || page < 1) return [];
    if (type === "movie" && /^tt\d{5,12}$/i.test(q)) {
      const found = await this.getByImdbId(q);
      return found ? [found] : [];
    }
    const tmdbPage = Math.ceil(page / 2);
    const offset = ((page - 1) % 2) * RESULTS_PER_PAGE;
    if (tmdbPage > 500) return [];
    const response = await request<TMDBResponse>(`/search/${type}`, {
      query: q, include_adult: "false", page: String(tmdbPage)
    });
    const chosen = (response.results || []).filter(x => !x.adult).slice(offset, offset + RESULTS_PER_PAGE);
    return chosen.map(x => mapItem(x, type));
  }
  async discover(kind: "popular" | "trending" | "top" | "upcoming", page = 1): Promise<MovieResult[]> {
    if (!Number.isInteger(page) || page < 1 || page > 500) return [];
    let endpoint = "/movie/popular";
    if (kind === "trending") endpoint = "/trending/movie/week";
    if (kind === "top") endpoint = "/movie/top_rated";
    if (kind === "upcoming") endpoint = "/movie/upcoming";
    const response = await request<TMDBResponse>(endpoint, { page: String(page) });
    return (response.results || []).filter(x => !x.adult).slice(0, RESULTS_PER_PAGE).map(x => mapItem(x));
  }
  async getDetails(movieId: string) { return details(movieId, "movie"); }
  async getTvDetails(tvId: string) { return details(tvId, "tv"); }
  async getByImdbId(imdbId: string): Promise<MovieResult | null> {
    if (!/^tt\d{5,12}$/i.test(imdbId)) return null;
    const found = await request<{ movie_results?: TMDBItem[]; tv_results?: TMDBItem[] }>(`/find/${encodeURIComponent(imdbId)}`, { external_source: "imdb_id" });
    const item = found.movie_results?.find(x => !x.adult);
    if (item) return details(String(item.id), "movie");
    const tv = found.tv_results?.[0];
    return tv ? details(String(tv.id), "tv") : null;
  }
  async getAuthorizedLinks(_movieId: string) {
    // No authorized media distributor has been configured.
    return [];
  }
}
export const mediaProvider: MediaProvider = new TMDBMediaProvider();
