import { validateAndNormalizeUrl } from './url.validator.js';
import { parseHtmlDocument } from './html.parser.js';
import { rankLinks } from './link.ranker.js';
import { fetchHtmlPage } from './http.fetcher.js';
import { checkRobotsAllowed } from './robots.js';
import type { CrawlerOptions, CompanyResearchResult, CrawledPage } from './crawler.types.js';

// Anti-prompt-injection sanitization to prevent untrusted web text from hijacking LLM prompts
export function sanitizeUntrustedWebText(text: string): string {
  return text
    .replace(/<\|im_start\|>|<\|im_end\|>/gi, '')
    .replace(/\[INST\]|\[\/INST\]/gi, '')
    .replace(/```(?:system|prompt)/gi, '```')
    .replace(/\b(ignore previous instructions|system prompt|developer mode|you are now|act as|pretend to be|forget everything|new instructions)\b/gi, '[redacted]')
    .replace(/\b(override|disregard|bypass|jailbreak|DAN|do anything now)\b/gi, '[redacted]')
    .replace(/(?:^|\n)\s*(?:system|assistant|user)\s*:/gim, '\n[data]:');
}

function extractCompanyName(url: string, pageTitle?: string): string {
  if (pageTitle && pageTitle.trim()) {
    const cleanedTitle = pageTitle.split(/[-|–•]/)[0].trim();
    if (cleanedTitle && cleanedTitle.length < 50 && !/home|welcome|index/i.test(cleanedTitle)) {
      return cleanedTitle;
    }
  }

  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.replace(/^www\./, '').split('.');
    if (parts.length > 0 && parts[0]) {
      return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    }
  } catch {
    // ignore
  }

  return 'Company';
}

function deduplicateParagraphs(paragraphs: string[]): string[] {
  const unique: string[] = [];
  for (const p of paragraphs) {
    const lower = p.toLowerCase();
    const isDuplicate = unique.some((existing) => {
      const existingLower = existing.toLowerCase();
      const shorter = Math.min(lower.length, existingLower.length);
      if (shorter === 0) return false;
      let matchingChars = 0;
      const limit = Math.min(lower.length, existingLower.length);
      for (let i = 0; i < limit; i++) {
        if (lower[i] === existingLower[i]) matchingChars++;
        else break;
      }
      return matchingChars / shorter > 0.7;
    });
    if (!isDuplicate) unique.push(p);
  }
  return unique;
}

function extractBriefSummary(homepageText: string, companyName: string): { summary: string; what_they_do: string } {
  const rawParagraphs = homepageText
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 40 && !p.toLowerCase().startsWith('cookie'));

  const paragraphs = deduplicateParagraphs(rawParagraphs);

  if (paragraphs.length === 0) {
    return {
      summary: `${companyName} overview extracted from primary website pages.`,
      what_they_do: `${companyName} operates in the software and technology sector.`,
    };
  }

  if (paragraphs.length === 1) {
    const text = paragraphs[0].substring(0, 300).trim();
    return {
      summary: text || `${companyName} overview.`,
      what_they_do: text || `${companyName} products and services.`,
    };
  }

  const summary = paragraphs.slice(0, Math.min(2, paragraphs.length)).join(' ').substring(0, 300).trim();
  const whatTheyDo = paragraphs.slice(Math.min(2, paragraphs.length), Math.min(4, paragraphs.length)).join(' ').substring(0, 300).trim()
    || paragraphs.slice(Math.min(1, paragraphs.length), Math.min(3, paragraphs.length)).join(' ').substring(0, 300).trim()
    || summary;

  return {
    summary: summary || `${companyName} overview.`,
    what_they_do: whatTheyDo || `${companyName} products and services.`,
  };
}

export async function researchCompany(
  rawUrl: string,
  options?: CrawlerOptions
): Promise<CompanyResearchResult> {
  const allowLocal = options?.allowLocal ?? (process.env.NODE_ENV !== 'production');
  const maxPages = Math.min(options?.maxPages ?? 3, 6);

  // 1. URL Validation & SSRF Guard
  const validation = validateAndNormalizeUrl(rawUrl, allowLocal);
  if (!validation.valid || !validation.normalizedUrl) {
    return {
      companyUrl: rawUrl,
      companyName: extractCompanyName(rawUrl),
      companyText: '',
      hiringText: '',
      sources: [],
      pagesUsed: [],
      hasHiringInfo: false,
      companyBrief: {
        summary: `Invalid company website URL: ${validation.error || rawUrl}.`,
        what_they_do: 'No website content could be retrieved.',
        sources: [],
      },
    };
  }

  const normalizedUrl = validation.normalizedUrl;
  const pagesUsed: string[] = [];
  const crawledPages: CrawledPage[] = [];

  // 2. Fetch Homepage
  const homepageFetch = await fetchHtmlPage(normalizedUrl, {
    timeoutMs: options?.timeoutMs ?? 8000,
    maxBytes: options?.maxBytes,
    rateLimitMs: options?.rateLimitMs,
    userAgent: options?.userAgent,
  });

  // Resilience: If homepage is unreachable or 404s, return graceful fallback rather than failing the run
  if (!homepageFetch.success || !homepageFetch.text) {
    return {
      companyUrl: normalizedUrl,
      companyName: extractCompanyName(normalizedUrl),
      companyText: '',
      hiringText: '',
      sources: [],
      pagesUsed: [],
      hasHiringInfo: false,
      companyBrief: {
        summary: `Could not retrieve ${normalizedUrl}: ${homepageFetch.error || 'Connection failed'}.`,
        what_they_do: 'Website could not be reached during research.',
        sources: [],
      },
    };
  }

  const homepageFinalUrl = homepageFetch.finalUrl || normalizedUrl;
  pagesUsed.push(homepageFinalUrl);

  const parsedHomepage = parseHtmlDocument(homepageFetch.text, homepageFinalUrl);
  const companyName = extractCompanyName(homepageFinalUrl, parsedHomepage.title);

  crawledPages.push({
    url: homepageFinalUrl,
    title: parsedHomepage.title,
    text: sanitizeUntrustedWebText(parsedHomepage.cleanText),
    statusCode: homepageFetch.status,
    isHiringRelated: false,
    isAboutRelated: true,
  });

  // 3. Dynamic Link Discovery & Ranking (Strictly NO hardcoded paths)
  const rankedCandidates = rankLinks(parsedHomepage.links, homepageFinalUrl);

  // 4. Crawl top candidate links within maxPages limit
  let subpageCount = 0;

  for (const candidate of rankedCandidates) {
    if (subpageCount >= maxPages) break;

    // Validate sub-page URL before fetching (SSRF protection)
    const subValidation = validateAndNormalizeUrl(candidate.url, allowLocal);
    if (!subValidation.valid || !subValidation.normalizedUrl) {
      continue;
    }

    // Respect robots.txt
    const allowedByRobots = await checkRobotsAllowed(candidate.url);
    if (!allowedByRobots) {
      continue;
    }

    const subpageFetch = await fetchHtmlPage(subValidation.normalizedUrl, {
      timeoutMs: options?.timeoutMs ?? 8000,
      maxBytes: options?.maxBytes,
      rateLimitMs: options?.rateLimitMs,
      userAgent: options?.userAgent,
    });

    // Resilience: Skip unreachable or 404 pages without breaking the whole process
    if (!subpageFetch.success || !subpageFetch.text) {
      continue;
    }

    const subpageFinalUrl = subpageFetch.finalUrl || candidate.url;
    if (!pagesUsed.includes(subpageFinalUrl)) {
      pagesUsed.push(subpageFinalUrl);
    }

    const parsedSubpage = parseHtmlDocument(subpageFetch.text, subpageFinalUrl);
    const sanitizedText = sanitizeUntrustedWebText(parsedSubpage.cleanText);

    crawledPages.push({
      url: subpageFinalUrl,
      title: parsedSubpage.title,
      text: sanitizedText,
      statusCode: subpageFetch.status,
      isHiringRelated: candidate.isHiringCandidate,
      isAboutRelated: candidate.isAboutCandidate,
    });

    subpageCount++;
  }

  // 5. Aggregate Text Segments
  const companySections: string[] = [];
  const hiringSections: string[] = [];

  for (const page of crawledPages) {
    const snippet = `--- Source: ${page.url} (${page.title || 'Page'}) ---\n${page.text.substring(0, 4000)}\n`;
    companySections.push(snippet);

    if (page.isHiringRelated || /interview|hiring|careers|process|apply|benefits|engineering culture/i.test(page.text)) {
      hiringSections.push(snippet);
    }
  }

  const companyText = companySections.join('\n\n');
  const hiringText = hiringSections.join('\n\n');
  const hasHiringInfo = hiringSections.length > 0;

  // 6. Formulate Appendix A company_brief structure
  const briefDetails = extractBriefSummary(parsedHomepage.cleanText, companyName);

  return {
    companyUrl: normalizedUrl,
    companyName,
    companyText,
    hiringText,
    sources: pagesUsed,
    pagesUsed,
    hasHiringInfo,
    companyBrief: {
      summary: briefDetails.summary,
      what_they_do: briefDetails.what_they_do,
      sources: pagesUsed,
    },
  };
}
