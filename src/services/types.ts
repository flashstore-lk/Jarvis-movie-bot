
export interface MovieResult {
  id: string;
  title: string;
  year?: number;
  overview?: string;
  rating?: string;
  ageRating?: string;
  sourceUrl?: string;
}

export interface MediaProvider {
  search(query: string): Promise<MovieResult[]>;

  getAuthorizedLinks(
    movieId: string
  ): Promise<
    Array<{
      label: string;
      url: string;
    }>
  >;
}
