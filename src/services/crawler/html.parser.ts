export interface ExtractedLink {
  rawHref: string;
  resolvedUrl: string;
  anchorText: string;
  isSameHost: boolean;
}

export interface ParsedHtmlDocument {
  title: string;
  cleanText: string;
  links: ExtractedLink[];
}

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&copy;': '©',
  '&trade;': '™',
  '&reg;': '®',
};

export function decodeHtmlEntities(str: string): string {
  let decoded = str.replace(
    /&(?:amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash|copy|trade|reg);/gi,
    (match) => HTML_ENTITY_MAP[match.toLowerCase()] || match
  );
  // Numeric character references &#123; or &#x1f;
  decoded = decoded.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return decoded;
}

export function cleanHtmlText(html: string, maxChars = 15000): string {
  if (!html) return '';

  let cleaned = html;

  // 1. Remove non-content elements and scripts completely
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  cleaned = cleaned.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');
  cleaned = cleaned.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ');
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ');

  // 2. Add spaces before block elements to preserve word separation
  cleaned = cleaned.replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|aside|blockquote)>/gi, '\n');
  cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');

  // 3. Strip all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // 4. Decode HTML entities
  cleaned = decodeHtmlEntities(cleaned);

  // 5. Normalize whitespace: collapse multiple spaces and blank lines
  cleaned = cleaned
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');

  // 6. Enforce max character limit
  if (cleaned.length > maxChars) {
    cleaned = cleaned.substring(0, maxChars) + '...';
  }

  return cleaned.trim();
}

export function extractTitle(html: string): string {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim();
  }

  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match && h1Match[1]) {
    return cleanHtmlText(h1Match[1]).replace(/\s+/g, ' ').trim();
  }

  return '';
}

export function extractLinks(html: string, baseUrl: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seenUrls = new Set<string>();

  let parsedBase: URL;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    return links;
  }

  // Regex matching <a ... href="..." ...>anchor text</a>
  const anchorRegex = /<a\b([^>]*?)href=(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const rawHref = match[3]?.trim();
    const rawAnchorText = match[5] || '';

    if (!rawHref) continue;

    // Ignore non-http links
    if (
      rawHref.startsWith('#') ||
      rawHref.startsWith('javascript:') ||
      rawHref.startsWith('mailto:') ||
      rawHref.startsWith('tel:') ||
      rawHref.startsWith('data:')
    ) {
      continue;
    }

    try {
      // Resolve relative link against base URL
      const resolved = new URL(rawHref, parsedBase);

      // Strip hash fragments
      resolved.hash = '';

      // Normalize protocol & hostname
      const resolvedString = resolved.toString();

      if (seenUrls.has(resolvedString)) {
        continue;
      }
      seenUrls.add(resolvedString);

      const anchorText = cleanHtmlText(rawAnchorText).replace(/\s+/g, ' ').trim();
      const isSameHost = resolved.hostname.toLowerCase() === parsedBase.hostname.toLowerCase();

      links.push({
        rawHref,
        resolvedUrl: resolvedString,
        anchorText,
        isSameHost,
      });
    } catch {
      // Invalid URL in href, skip gracefully
      continue;
    }
  }

  return links;
}

export function parseHtmlDocument(html: string, baseUrl: string): ParsedHtmlDocument {
  return {
    title: extractTitle(html),
    cleanText: cleanHtmlText(html),
    links: extractLinks(html, baseUrl),
  };
}
