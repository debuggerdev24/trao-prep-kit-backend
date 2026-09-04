export interface PublicSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  maxResults?: number;
  timeoutMs?: number;
}

export interface IPublicSearchProvider {
  search(query: string, options?: SearchOptions): Promise<PublicSearchResultItem[]>;
}
