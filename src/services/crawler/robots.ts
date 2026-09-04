const robotsCache = new Map<string, string[]>();

export function parseDisallowedPaths(robotsTxt: string): string[] {
  const disallowed: string[] = [];
  const lines = robotsTxt.split('\n');
  let appliesToAll = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const [key, ...rest] = line.split(':');
    const value = rest.join(':').trim();

    if (key.toLowerCase() === 'user-agent') {
      appliesToAll = value === '*';
    } else if (appliesToAll && key.toLowerCase() === 'disallow') {
      if (value) {
        disallowed.push(value);
      }
    }
  }

  return disallowed;
}

export function isPathDisallowed(pathname: string, disallowedRules: string[]): boolean {
  for (const rule of disallowedRules) {
    if (rule === '/') return true;
    if (pathname.startsWith(rule)) return true;
  }
  return false;
}

export async function checkRobotsAllowed(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;

    let disallowedRules = robotsCache.get(origin);

    if (!disallowedRules) {
      const robotsUrl = `${origin}/robots.txt`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(robotsUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'TraoInterviewPrepCrawler/1.0' },
        });
        clearTimeout(timer);

        if (res.ok) {
          const text = await res.text();
          disallowedRules = parseDisallowedPaths(text);
        } else {
          disallowedRules = [];
        }
      } catch {
        clearTimeout(timer);
        disallowedRules = [];
      }
      robotsCache.set(origin, disallowedRules);
    }

    return !isPathDisallowed(parsed.pathname, disallowedRules);
  } catch {
    return true; // On error, allow gracefully
  }
}
