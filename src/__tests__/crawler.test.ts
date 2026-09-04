import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import {
  validateAndNormalizeUrl,
  cleanHtmlText,
  extractLinks,
  decodeHtmlEntities,
  rankLinks,
  parseDisallowedPaths,
  isPathDisallowed,
  researchCompany,
} from '../services/crawler/index.js';

describe('Company Website Crawler & Research (Phase 4)', () => {
  describe('URL Validation & SSRF Guard', () => {
    it('accepts valid http and https URLs', () => {
      const res1 = validateAndNormalizeUrl('https://example.com');
      assert.strictEqual(res1.valid, true);
      assert.strictEqual(res1.normalizedUrl, 'https://example.com/');

      const res2 = validateAndNormalizeUrl('http://techcorp.io/about');
      assert.strictEqual(res2.valid, true);
    });

    it('rejects malformed or empty URLs', () => {
      assert.strictEqual(validateAndNormalizeUrl('').valid, false);
      assert.strictEqual(validateAndNormalizeUrl('not-a-valid-url').valid, false);
      assert.strictEqual(validateAndNormalizeUrl('ftp://ftp.example.com').valid, false);
    });

    it('allows localhost fixtures in test environment', () => {
      const res = validateAndNormalizeUrl('http://localhost:8099/acme/', true);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.isLocal, true);
    });
  });

  describe('HTML Text Cleaning & Entity Decoding', () => {
    it('strips script, style tags and collapses whitespace', () => {
      const rawHtml = `
        <html>
          <head>
            <style>body { color: red; }</style>
            <script>console.log("malicious");</script>
          </head>
          <body>
            <h1>Acme &amp; Sons &mdash; Cloud Infrastructure</h1>
            <p>We build &quot;scalable&quot; APIs for fintech.</p>
          </body>
        </html>
      `;

      const cleaned = cleanHtmlText(rawHtml);
      assert.ok(!cleaned.includes('console.log'));
      assert.ok(!cleaned.includes('color: red'));
      assert.ok(cleaned.includes('Acme & Sons — Cloud Infrastructure'));
      assert.ok(cleaned.includes('We build "scalable" APIs for fintech.'));
    });

    it('decodes HTML entities properly', () => {
      assert.strictEqual(decodeHtmlEntities('&lt;div&gt;&copy; 2026&lt;/div&gt;'), '<div>© 2026</div>');
    });
  });

  describe('Relative Link Normalization', () => {
    it('normalizes root-relative, page-relative, and preserves query while stripping hashes', () => {
      const baseUrl = 'http://localhost:8099/acme/';
      const html = `
        <div>
          <a href="/about-us">About Us</a>
          <a href="careers/openings">Join Our Team</a>
          <a href="https://example.com/culture#values">Our Culture</a>
          <a href="javascript:void(0)">Click Here</a>
          <a href="mailto:jobs@example.com">Email Us</a>
        </div>
      `;

      const links = extractLinks(html, baseUrl);

      // Verify normalization
      const aboutLink = links.find((l) => l.anchorText === 'About Us');
      assert.ok(aboutLink);
      assert.strictEqual(aboutLink.resolvedUrl, 'http://localhost:8099/about-us');

      const careersLink = links.find((l) => l.anchorText === 'Join Our Team');
      assert.ok(careersLink);
      assert.strictEqual(careersLink.resolvedUrl, 'http://localhost:8099/acme/careers/openings');

      const cultureLink = links.find((l) => l.anchorText === 'Our Culture');
      assert.ok(cultureLink);
      assert.strictEqual(cultureLink.resolvedUrl, 'https://example.com/culture'); // Hash stripped

      // Non-HTTP links ignored
      assert.strictEqual(links.some((l) => l.rawHref.startsWith('javascript:')), false);
      assert.strictEqual(links.some((l) => l.rawHref.startsWith('mailto:')), false);
    });
  });

  describe('Dynamic Page Ranking (No Hardcoded Paths)', () => {
    it('ranks hiring, about, and culture links significantly higher than terms, privacy, and login', () => {
      const baseUrl = 'https://acme-fintech.com';
      const extractedLinks = [
        { rawHref: '/login', resolvedUrl: 'https://acme-fintech.com/login', anchorText: 'Sign In', isSameHost: true },
        { rawHref: '/terms', resolvedUrl: 'https://acme-fintech.com/terms', anchorText: 'Terms of Service', isSameHost: true },
        { rawHref: '/careers', resolvedUrl: 'https://acme-fintech.com/careers', anchorText: 'Work with us', isSameHost: true },
        { rawHref: '/our-story', resolvedUrl: 'https://acme-fintech.com/our-story', anchorText: 'About the company', isSameHost: true },
        { rawHref: '/engineering-handbook', resolvedUrl: 'https://acme-fintech.com/engineering-handbook', anchorText: 'Engineering Handbook', isSameHost: true },
      ];

      const ranked = rankLinks(extractedLinks, baseUrl);

      assert.ok(ranked.length >= 2);
      // Careers or engineering handbook should be top ranked
      assert.ok(ranked[0].isHiringCandidate || ranked[0].isAboutCandidate);
      assert.ok(ranked[0].score > 30);

      // Login and terms should not be top ranked
      const topUrls = ranked.slice(0, 2).map((r) => r.url);
      assert.ok(!topUrls.includes('https://acme-fintech.com/login'));
      assert.ok(!topUrls.includes('https://acme-fintech.com/terms'));
    });
  });

  describe('Robots.txt Evaluation', () => {
    it('correctly parses disallowed paths for wildcard user agents', () => {
      const robotsTxt = `
        User-agent: Googlebot
        Disallow: /google-only/

        User-agent: *
        Disallow: /admin/
        Disallow: /private/
        Disallow: /api/
      `;

      const disallowed = parseDisallowedPaths(robotsTxt);
      assert.deepStrictEqual(disallowed, ['/admin/', '/private/', '/api/']);

      assert.strictEqual(isPathDisallowed('/admin/dashboard', disallowed), true);
      assert.strictEqual(isPathDisallowed('/private/keys', disallowed), true);
      assert.strictEqual(isPathDisallowed('/careers', disallowed), false);
      assert.strictEqual(isPathDisallowed('/about', disallowed), false);
    });
  });

  describe('Full Crawler with Mock Local Test Server', () => {
    let server: http.Server;
    let localPort = 0;
    let localBaseUrl = '';

    before(async () => {
      // Create lightweight local HTTP test fixture server
      server = http.createServer((req, res) => {
        const url = req.url || '/';

        if (url === '/' || url === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>Acme Global - Cloud Infrastructure</title></head>
              <body>
                <h1>Welcome to Acme Global</h1>
                <p>Acme Global delivers high-throughput enterprise messaging platforms and real-time distributed pipelines.</p>
                <nav>
                  <a href="/our-company">About Our Story</a>
                  <a href="/join-our-team">Work With Us (Careers)</a>
                  <a href="/missing-page-404">Broken Link</a>
                  <a href="/terms-and-conditions">Terms</a>
                </nav>
              </body>
            </html>
          `);
        } else if (url === '/our-company') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>About Acme Global</title></head>
              <body>
                <h1>Our Mission</h1>
                <p>We empower fintech developers with low-latency APIs across 40 global cloud regions.</p>
              </body>
            </html>
          `);
        } else if (url === '/join-our-team') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Careers at Acme Global</title></head>
              <body>
                <h1>Hiring at Acme Global</h1>
                <p>Our interview process consists of a technical discussion, architectural pairing, and values alignment.</p>
                <p>We are actively looking for Senior Distributed Systems Engineers and Tech Leads.</p>
              </body>
            </html>
          `);
        } else if (url === '/slow-page') {
          // Intentionally does not respond immediately
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Slow</h1>');
          }, 2000);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<h1>404 Not Found</h1>');
        }
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            localPort = addr.port;
            localBaseUrl = `http://127.0.0.1:${localPort}`;
          }
          resolve();
        });
      });
    });

    after(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    it('successfully crawls local test fixture, discovers hiring page, and skips 404 cleanly', async () => {
      const result = await researchCompany(localBaseUrl, {
        allowLocal: true,
        maxPages: 3,
        timeoutMs: 3000,
        rateLimitMs: 10,
      });

      assert.strictEqual(result.hasHiringInfo, true);
      assert.ok(result.pagesUsed.length >= 2, 'Should have used homepage and at least one discovered subpage');
      assert.ok(result.pagesUsed.some((p) => p.includes('join-our-team')));
      assert.ok(result.hiringText.includes('interview process'));
      assert.ok(result.companyText.includes('enterprise messaging'));
      assert.strictEqual(result.companyBrief.sources.length, result.pagesUsed.length);
      assert.ok(result.companyBrief.summary.length > 0);

      // Verify broken link did not crash the crawl
      assert.ok(!result.pagesUsed.some((p) => p.includes('missing-page-404')));
    });

    it('handles website with missing hiring page without crashing (hasHiringInfo: false)', async () => {
      // Crawl specifically starting at /our-company which has no hiring links
      const result = await researchCompany(`${localBaseUrl}/our-company`, {
        allowLocal: true,
        maxPages: 2,
        timeoutMs: 3000,
        rateLimitMs: 10,
      });

      assert.strictEqual(result.hasHiringInfo, false);
      assert.ok(result.companyBrief.summary.includes('fintech developers'));
      assert.strictEqual(result.pagesUsed.length, 1);
    });

    it('handles homepage 404 gracefully with informative fallback summary', async () => {
      const result = await researchCompany(`${localBaseUrl}/non-existent-homepage`, {
        allowLocal: true,
        timeoutMs: 2000,
      });

      assert.strictEqual(result.hasHiringInfo, false);
      assert.strictEqual(result.pagesUsed.length, 0);
      assert.ok(result.companyBrief.summary.includes('Could not retrieve'));
    });

    it('strictly respects maxPages limits', async () => {
      const result = await researchCompany(localBaseUrl, {
        allowLocal: true,
        maxPages: 1, // Only 1 additional page allowed
        timeoutMs: 3000,
        rateLimitMs: 10,
      });

      // Homepage (1) + at most 1 subpage = max 2 pages
      assert.ok(result.pagesUsed.length <= 2);
    });

    it('handles timeout safely without crashing', async () => {
      const result = await researchCompany(`${localBaseUrl}/slow-page`, {
        allowLocal: true,
        timeoutMs: 150, // Fast timeout triggers abort
        maxPages: 0,
      });

      assert.strictEqual(result.hasHiringInfo, false);
      assert.ok(result.companyBrief.summary.includes('timed out') || result.companyBrief.summary.includes('Could not retrieve'));
    });
  });
});
