import type { ExtractedLink } from './html.parser.js';
import type { DiscoveredLink } from './crawler.types.js';

// Semantic keyword groups for dynamic link ranking (no hardcoded fixed paths)
const HIRING_KEYWORDS = [
  'career',
  'careers',
  'job',
  'jobs',
  'hiring',
  'hire',
  'join',
  'work-with-us',
  'work-at',
  'working-here',
  'openings',
  'positions',
  'opportunities',
  'vacancies',
  'interview',
  'how-we-hire',
  'recruiting',
  'apply',
];

const CULTURE_TECH_KEYWORDS = [
  'culture',
  'handbook',
  'engineering',
  'tech',
  'blog',
  'values',
  'life',
  'people',
  'team',
];

const ABOUT_KEYWORDS = [
  'about',
  'company',
  'mission',
  'story',
  'what-we-do',
  'who-we-are',
  'overview',
  'products',
  'platform',
];

const PENALIZED_KEYWORDS = [
  'login',
  'signin',
  'sign-in',
  'signup',
  'sign-up',
  'register',
  'cart',
  'checkout',
  'basket',
  'privacy',
  'terms',
  'cookie',
  'legal',
  'security',
  'compliance',
  'support',
  'help',
  'status',
  'pricing',
  'billing',
  'download',
];

const DISALLOWED_EXTENSIONS = /\.(pdf|zip|gz|tar|exe|dmg|png|jpg|jpeg|gif|svg|webp|ico|css|js|json|xml|rss)$/i;

function extractTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

export function scoreLink(link: ExtractedLink, baseHost: string): DiscoveredLink {
  let score = 0;
  let isHiringCandidate = false;
  let isAboutCandidate = false;

  let parsed: URL;
  try {
    parsed = new URL(link.resolvedUrl);
  } catch {
    return {
      url: link.resolvedUrl,
      anchorText: link.anchorText,
      score: -100,
      isHiringCandidate: false,
      isAboutCandidate: false,
    };
  }

  // Reject static assets and document downloads
  if (DISALLOWED_EXTENSIONS.test(parsed.pathname)) {
    return {
      url: link.resolvedUrl,
      anchorText: link.anchorText,
      score: -100,
      isHiringCandidate: false,
      isAboutCandidate: false,
    };
  }

  // Prefer internal pages over external third-party links
  const isSameHost = parsed.hostname.toLowerCase() === baseHost.toLowerCase();
  if (isSameHost) {
    score += 15;
  } else {
    // Heavily penalize common third-party marketing or social media links
    if (/twitter|facebook|instagram|youtube|github|linkedin|tiktok/i.test(parsed.hostname)) {
      score -= 50;
    }
  }

  // Combine URL path and anchor text tokens for semantic evaluation
  const pathTokens = extractTokens(parsed.pathname);
  const anchorTokens = extractTokens(link.anchorText);
  const combinedTokens = new Set([...pathTokens, ...anchorTokens]);

  // 1. Hiring & Interview Signals (highest priority for the kit)
  for (const kw of HIRING_KEYWORDS) {
    if (combinedTokens.has(kw)) {
      score += 40;
      isHiringCandidate = true;
    }
    // Partial substring match for compound paths like /careers-at-acme
    if (parsed.pathname.toLowerCase().includes(kw)) {
      score += 20;
      isHiringCandidate = true;
    }
  }

  // 2. Culture, Engineering, and Handbook Signals
  for (const kw of CULTURE_TECH_KEYWORDS) {
    if (combinedTokens.has(kw)) {
      score += 25;
      if (['handbook', 'engineering', 'culture'].includes(kw)) {
        isHiringCandidate = true; // Often houses hiring/interview details
      }
    }
  }

  // 3. About & Company Overview Signals
  for (const kw of ABOUT_KEYWORDS) {
    if (combinedTokens.has(kw)) {
      score += 20;
      isAboutCandidate = true;
    }
  }

  // 4. Penalties for low-value pages
  for (const kw of PENALIZED_KEYWORDS) {
    if (combinedTokens.has(kw)) {
      score -= 60;
    }
  }

  // Bonus if anchor text specifically mentions hiring or culture
  const lowerAnchor = link.anchorText.toLowerCase();
  if (/work with us|join our team|how we hire|interview process|life at/i.test(lowerAnchor)) {
    score += 35;
    isHiringCandidate = true;
  }

  return {
    url: link.resolvedUrl,
    anchorText: link.anchorText,
    score,
    isHiringCandidate,
    isAboutCandidate,
  };
}

export function rankLinks(links: ExtractedLink[], baseUrl: string): DiscoveredLink[] {
  let baseHost = '';
  try {
    baseHost = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return [];
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '').toLowerCase();
  const scoredLinks: DiscoveredLink[] = [];
  const seenUrls = new Set<string>();

  for (const link of links) {
    // Avoid re-crawling the homepage
    const normalizedTarget = link.resolvedUrl.replace(/\/+$/, '').toLowerCase();
    if (normalizedTarget === normalizedBaseUrl || seenUrls.has(normalizedTarget)) {
      continue;
    }
    seenUrls.add(normalizedTarget);

    const scored = scoreLink(link, baseHost);
    if (scored.score > 0) {
      scoredLinks.push(scored);
    }
  }

  // Sort descending by relevance score
  return scoredLinks.sort((a, b) => b.score - a.score);
}
