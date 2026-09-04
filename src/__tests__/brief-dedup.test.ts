import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import the internal function by re-implementing it here (it's not exported)
// We test the deduplication logic and the brief extraction logic

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

describe('Company Brief Deduplication', () => {
  it('deduplicates near-identical consecutive paragraphs', () => {
    const text = [
      'Financial infrastructure to grow your revenue.',
      'Accept payments, offer financial services and implement custom revenue models.',
      'Financial infrastructure to grow your revenue. Accept payments, offer financial services.',
      'Millions of companies of all sizes use Stripe to accept payments.',
      'Build a platform that connects businesses with their customers.',
      'The economic infrastructure for the internet.',
    ].join('\n');

    const raw = text.split('\n').map(p => p.trim()).filter(p => p.length > 40);
    const deduped = deduplicateParagraphs(raw);

    assert.ok(deduped.length < raw.length, `Expected deduped (${deduped.length}) < raw (${raw.length})`);

    const result = extractBriefSummary(text, 'Stripe');
    assert.ok(result.summary.length > 0, 'summary should not be empty');
    assert.ok(result.what_they_do.length > 0, 'what_they_do should not be empty');
    assert.notEqual(result.summary, result.what_they_do, 'summary and what_they_do should be different');
  });

  it('produces distinct summary and what_they_do for Stripe-like homepage', () => {
    const stripeText = [
      'Financial infrastructure to grow your revenue. Accept payments, offer financial services and implement custom revenue models — from your first transaction to your billionth.',
      'Financial infrastructure to grow your revenue. Accept payments, offer financial services and implement custom revenue models — from your first transaction to your billionth.',
      'Millions of companies of all sizes use Stripe to accept payments, manage subscriptions, build marketplaces, and much more.',
      'Stripe is a financial infrastructure platform for businesses. Millions of companies—from the world’s largest enterprises to the most ambitious startups—use Stripe to accept payments, grow their revenue, and accelerate new business opportunities.',
      'Build with Stripe or use Stripe out-of-the-box products to manage your business, grow revenue, and cover more use cases.',
    ].join('\n');

    const result = extractBriefSummary(stripeText, 'Stripe');
    assert.ok(result.summary.length > 0, 'summary should not be empty');
    assert.ok(result.what_they_do.length > 0, 'what_they_do should not be empty');
    assert.notEqual(result.summary, result.what_they_do, 'summary and what_they_do must differ');
  });

  it('handles single paragraph gracefully', () => {
    const result = extractBriefSummary('A single long paragraph that describes the company well enough.', 'Acme');
    assert.ok(result.summary.length > 0);
    assert.ok(result.what_they_do.length > 0);
  });

  it('falls back gracefully on empty text', () => {
    const result = extractBriefSummary('', 'Acme');
    assert.ok(result.summary.includes('Acme'));
    assert.ok(result.what_they_do.includes('Acme'));
  });

  it('preserves distinct paragraphs without deduplication', () => {
    const text = [
      'Acme Corp builds enterprise software for Fortune 500 companies.',
      'Their flagship product AcmeCloud powers real-time data pipelines.',
      'Founded in 2010, Acme has grown to 5000 employees worldwide.',
      'Acme recently IPOd at a valuation of $10 billion.',
    ].join('\n');

    const result = extractBriefSummary(text, 'Acme');
    assert.ok(result.summary.length > 0);
    assert.ok(result.what_they_do.length > 0);
    assert.notEqual(result.summary, result.what_they_do);
  });
});
