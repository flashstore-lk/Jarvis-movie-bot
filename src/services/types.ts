
export interface MovieResult {
  id: string;
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

  getDetails(movieId: string): Promise<MovieResult | null>;

  getAuthorizedLinks(
    movieId: string
  ): Promise<Array<{
    label: string;
    url: string;
  }>>;
}
