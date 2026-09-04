import type { IPublicSearchProvider, PublicSearchResultItem, SearchOptions } from './provider.types.js';
import { cleanHtmlText } from '../crawler/html.parser.js';

export class PublicWebSearchProvider implements IPublicSearchProvider {
  private userAgent: string;

  constructor(userAgent?: string) {
    this.userAgent =
      userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  async search(query: string, options?: SearchOptions): Promise<PublicSearchResultItem[]> {
    const maxResults = options?.maxResults ?? 5;
    const timeoutMs = options?.timeoutMs ?? 6000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Use DuckDuckGo HTML lite search endpoint
      const encodedQuery = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `q=${encodedQuery}`,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        return [];
      }

      const html = await res.text();
      return this.parseDuckDuckGoHtml(html, maxResults);
    } catch {
      clearTimeout(timer);
      // On network failure or bot verification, return empty array gracefully
      return [];
    }
  }

  private parseDuckDuckGoHtml(html: string, maxResults: number): PublicSearchResultItem[] {
    const items: PublicSearchResultItem[] = [];

    // DuckDuckGo HTML results are contained in <div class="result ..."> blocks
    const resultBlockRegex = /<div\b[^>]*class=["'][^"']*result\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let blockMatch: RegExpExecArray | null;

    while ((blockMatch = resultBlockRegex.exec(html)) !== null && items.length < maxResults) {
      const blockHtml = blockMatch[1];

      // Extract URL and Title: <a class="result__url" href="..."> or <a class="result__snippet" ...>
      const linkMatch = /<a\b[^>]*class=["'][^"']*result__snippet\b[^"']*["'][^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/i.exec(
        blockHtml
      ) || /<a\b[^>]*class=["'][^"']*result__url\b[^"']*["'][^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/i.exec(
        blockHtml
      );

      const titleMatch = /<a\b[^>]*class=["'][^"']*result__title\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(
        blockHtml
      );

      const snippetMatch = /<a\b[^>]*class=["'][^"']*result__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(
        blockHtml
      );

      let targetUrl = '';
      if (linkMatch && linkMatch[1]) {
        targetUrl = linkMatch[1];
        // DDG uses redirect links like //duckduckgo.com/l/?uddg=https%3A%2F%2F...
        const uddgMatch = /uddg=([^&]+)/i.exec(targetUrl);
        if (uddgMatch && uddgMatch[1]) {
          targetUrl = decodeURIComponent(uddgMatch[1]);
        }
      }

      const title = titleMatch ? cleanHtmlText(titleMatch[1]) : '';
      const snippet = snippetMatch ? cleanHtmlText(snippetMatch[1]) : '';

      if (targetUrl && (title || snippet)) {
        items.push({
          title,
          url: targetUrl,
          snippet,
        });
      }
    }

    return items;
  }
}
