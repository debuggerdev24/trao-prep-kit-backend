import type { IPublicSearchProvider, PublicSearchResultItem, SearchOptions } from './provider.types.js';

export class MockPublicSearchProvider implements IPublicSearchProvider {
  private results: PublicSearchResultItem[];
  private shouldFail: boolean;
  private failureError: string;
  public lastQuery = '';
  public callCount = 0;

  constructor(options?: {
    results?: PublicSearchResultItem[];
    shouldFail?: boolean;
    failureError?: string;
  }) {
    this.results = options?.results ?? [];
    this.shouldFail = options?.shouldFail ?? false;
    this.failureError = options?.failureError ?? 'Simulated search network failure';
  }

  async search(query: string, options?: SearchOptions): Promise<PublicSearchResultItem[]> {
    this.callCount++;
    this.lastQuery = query;

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    const limit = options?.maxResults ?? 5;
    return this.results.slice(0, limit);
  }

  setResults(results: PublicSearchResultItem[]): void {
    this.results = results;
  }

  setShouldFail(shouldFail: boolean, errorMessage?: string): void {
    this.shouldFail = shouldFail;
    if (errorMessage) {
      this.failureError = errorMessage;
    }
  }
}
