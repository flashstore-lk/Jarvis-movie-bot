export interface MovieResult {
  id: string;
  mediaType?: "movie" | "tv";
  title: string;
  year?: number;
  overview?: string;
  rating?: string;
  ageRating?: string;
  sourceUrl?: string;
  runtime?: number;
  genres?: string[];
  imdbId?: string;
  posterUrl?: string;
  countries?: string[];
  directors?: string[];
}

export interface MediaProvider {
  search(query: string, page?: number): Promise<MovieResult[]>;
  searchTv(query: string, page?: number): Promise<MovieResult[]>;
  discover(kind: "popular" | "trending" | "top" | "upcoming", page?: number): Promise<MovieResult[]>;
  getDetails(movieId: string): Promise<MovieResult | null>;
  getTvDetails(tvId: string): Promise<MovieResult | null>;
  getByImdbId(imdbId: string): Promise<MovieResult | null>;
  getAuthorizedLinks(movieId: string): Promise<Array<{ label: string; url: string }>>;
}
