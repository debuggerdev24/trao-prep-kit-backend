export interface FetchResult {
  success: boolean;
  status: number;
  text?: string;
  finalUrl?: string;
  contentType?: string;
  error?: string;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRetries?: number;
  userAgent?: string;
  rateLimitMs?: number;
}

// Track last request timestamp per origin to enforce politeness rate-limiting
const originLastRequestMap = new Map<string, number>();

async function enforcePolitenessDelay(url: string, delayMs: number): Promise<void> {
  if (delayMs <= 0) return;

  try {
    const origin = new URL(url).origin;
    const lastRequest = originLastRequestMap.get(origin) || 0;
    const now = Date.now();
    const elapsed = now - lastRequest;

    if (elapsed < delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs - elapsed));
    }
    originLastRequestMap.set(origin, Date.now());
  } catch {
    // If URL parsing fails, ignore delay
  }
}

export function isRedirectToPrivateOrigin(originalUrl: string, redirectUrl: string): boolean {
  try {
    const orig = new URL(originalUrl)
    const redir = new URL(redirectUrl)
    // If redirect changes origin, validate the new origin
    if (orig.origin !== redir.origin) {
      const hostname = redir.hostname.toLowerCase()
      // Block redirects to private/loopback IPs
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') return true
      if (/^10\./.test(hostname) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) || /^192\.168\./.test(hostname)) return true
      if (/^169\.254\./.test(hostname)) return true
      if (redir.protocol === 'file:' || redir.protocol === 'data:') return true
    }
    return false
  } catch {
    return true // If we can't parse, block it
  }
}

export async function fetchHtmlPage(url: string, options?: FetchOptions): Promise<FetchResult> {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const maxBytes = options?.maxBytes ?? 2 * 1024 * 1024; // 2MB
  const maxRetries = options?.maxRetries ?? 2;
  const rateLimitMs = options?.rateLimitMs ?? 150;
  const userAgent = options?.userAgent || 'TraoInterviewPrepCrawler/1.0 (+https://example.com/bot)';

  let attempt = 0;

  while (attempt <= maxRetries) {
    await enforcePolitenessDelay(url, rateLimitMs);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      // Validate redirect didn't go to a private origin
      if (response.url && response.url !== url && isRedirectToPrivateOrigin(url, response.url)) {
        return {
          success: false,
          status: 0,
          error: 'Redirect to private/loopback address blocked',
        }
      }

      const status = response.status;

      // Handle transient failures with exponential backoff
      if ((status === 429 || status === 502 || status === 503 || status === 504) && attempt < maxRetries) {
        attempt++;
        const backoff = 200 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      if (!response.ok) {
        return {
          success: false,
          status,
          finalUrl: response.url || url,
          error: `HTTP ${status} ${response.statusText}`,
        };
      }

      const contentType = response.headers.get('content-type') || '';
      // Security check: restrict expected content types
      const isAcceptable =
        contentType.includes('text/html') ||
        contentType.includes('application/xhtml+xml') ||
        contentType.includes('text/plain');

      if (!isAcceptable && !contentType.includes('application/xml')) {
        return {
          success: false,
          status,
          finalUrl: response.url || url,
          contentType,
          error: `Skipping non-HTML response content-type: "${contentType}"`,
        };
      }

      // Read response text with byte-size guard
      const rawText = await response.text();
      const truncatedText = rawText.length > maxBytes ? rawText.substring(0, maxBytes) : rawText;

      return {
        success: true,
        status,
        text: truncatedText,
        finalUrl: response.url || url,
        contentType,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));

      if (isAbort) {
        return {
          success: false,
          status: 408,
          error: `Request timed out after ${timeoutMs}ms`,
        };
      }

      if (attempt < maxRetries) {
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }

      return {
        success: false,
        status: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    success: false,
    status: 0,
    error: 'Max retries exceeded',
  };
}
