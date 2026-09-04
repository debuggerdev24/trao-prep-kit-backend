export interface CrawlerOptions {
  maxPages?: number;        // Maximum number of additional pages to crawl (default: 3)
  timeoutMs?: number;       // Per-request timeout in milliseconds (default: 8000)
  rateLimitMs?: number;     // Delay between requests to same host (default: 150)
  maxBytes?: number;        // Maximum response size to read (default: 2 * 1024 * 1024 = 2MB)
  allowLocal?: boolean;     // Permit loopback/local addresses for test evaluation fixtures
  userAgent?: string;       // User-Agent string
}

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
  statusCode: number;
  isHiringRelated: boolean;
  isAboutRelated: boolean;
}

export interface DiscoveredLink {
  url: string;
  anchorText: string;
  score: number;
  isHiringCandidate: boolean;
  isAboutCandidate: boolean;
}

export interface CompanyBriefData {
  summary: string;
  what_they_do: string;
  sources: string[];
}

export interface CompanyResearchResult {
  companyUrl: string;
  companyName?: string;
  companyText: string;
  hiringText: string;
  sources: string[];
  pagesUsed: string[];
  hasHiringInfo: boolean;
  companyBrief: CompanyBriefData;
}
