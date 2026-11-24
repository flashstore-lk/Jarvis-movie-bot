export interface MovieSearchItem {
  title: string;
  year?: string;
  imdbId?: string;
  rating?: string;
  posterUrl?: string;
  providerMovieId: string;
  ageRating?: string;
}

export interface MovieDetails extends MovieSearchItem {
  overview?: string;
  runtimeMinutes?: number;
  genres?: string[];
  qualities: Array<{ label: string; providerFileId: string; size?: string }>;
}

export interface AuthorizedMediaProvider {
  search(query: string): Promise<MovieSearchItem[]>;
  details(movie: MovieSearchItem): Promise<MovieDetails>;
  createDelivery(fileId: string): Promise<{ url: string; expiresAt?: string }>;
}
