import type {
  InterviewResearchOptions,
  PublicInterviewResearchResult,
  InterviewResearchConfidence,
} from './interview-research.types.js';
import type { PublicSearchResultItem } from './provider.types.js';
import { PublicWebSearchProvider } from './web.provider.js';

const INTERVIEW_SIGNAL_KEYWORDS = [
  'interview',
  'interviews',
  'interviewing',
  'recruiter',
  'screening',
  'coding round',
  'technical screen',
  'take-home',
  'hackerrank',
  'leetcode',
  'system design',
  'onsite',
  'virtual onsite',
  'behavioral',
  'hiring manager',
  'rounds',
  'questions asked',
  'assessment',
];

// Anti-prompt-injection sanitization to prevent web snippets from acting as LLM instructions
function sanitizeUntrustedSnippet(text: string): string {
  return text
    .replace(/<\|im_start\|>|<\|im_end\|>/gi, '')
    .replace(/\[INST\]|\[\/INST\]/gi, '')
    .replace(/```(?:system|prompt)/gi, '```')
    .replace(/\b(ignore previous instructions|system prompt|developer mode)\b/gi, '[redacted]')
    .trim();
}

function extractMentionedRounds(snippets: string[]): string[] {
  const combined = snippets.join(' ').toLowerCase();
  const detectedRounds: string[] = [];

  if (/recruiter|phone screen|screening call|initial chat/i.test(combined)) {
    detectedRounds.push('Recruiter / Screening Call (Resume review, role alignment)');
  }
  if (/coding|leetcode|algorithms|data structures|live coding|take-home|hackerrank/i.test(combined)) {
    detectedRounds.push('Technical Coding Assessment (Data structures, algorithms, problem solving)');
  }
  if (/system design|high-level design|architecture|distributed/i.test(combined)) {
    detectedRounds.push('System Design / Architecture Round (Scalability, trade-offs, service design)');
  }
  if (/behavioral|culture|values|leadership principles|situational|fit/i.test(combined)) {
    detectedRounds.push('Behavioral & Leadership Fit (Past projects, collaboration, culture alignment)');
  }
  if (/hiring manager|manager round|director/i.test(combined)) {
    detectedRounds.push('Hiring Manager Discussion (Expectations, team impact, career goals)');
  }

  return detectedRounds;
}

function extractFocusAreas(snippets: string[]): string[] {
  const combined = snippets.join(' ').toLowerCase();
  const focusAreas = new Set<string>();

  if (/coding|algorithms|leetcode/i.test(combined)) focusAreas.add('Algorithmic problem-solving');
  if (/system design|scalability/i.test(combined)) focusAreas.add('Distributed systems & scalability');
  if (/take-home|practical code/i.test(combined)) focusAreas.add('Clean code & practical architecture');
  if (/behavioral|star method|values/i.test(combined)) focusAreas.add('STAR-format behavioral responses');
  if (/concurrency|performance|low latency/i.test(combined)) focusAreas.add('Concurrency and performance optimization');
  if (/frontend|react|css/i.test(combined)) focusAreas.add('Modern frontend architecture & state management');

  return Array.from(focusAreas);
}

export async function researchPublicInterviewProcess(
  companyName: string,
  roleTitle?: string,
  options?: InterviewResearchOptions
): Promise<PublicInterviewResearchResult> {
  const trimmedCompany = companyName?.trim() || '';

  if (!trimmedCompany) {
    return {
      companyName: '',
      roleTitle,
      foundUsefulInfo: false,
      interviewProcessText: '',
      roundsSummary: [],
      focusAreas: [],
      sourceUrls: [],
      confidence: 'none',
    };
  }

  const provider = options?.searchProvider || new PublicWebSearchProvider();
  const maxSources = options?.maxSources ?? 4;
  const roleContext = roleTitle?.trim() || 'Software Engineer';

  const query = `"${trimmedCompany}" "${roleContext}" interview process questions rounds`;

  let rawResults: PublicSearchResultItem[] = [];
  try {
    rawResults = await provider.search(query, {
      maxResults: maxSources * 2,
      timeoutMs: options?.timeoutMs ?? 5000,
    });
  } catch (err: unknown) {
    // Search failures are handled gracefully without crashing
    console.warn(`[Public Interview Research] Search query failed for ${trimmedCompany}:`, err);
    return {
      companyName: trimmedCompany,
      roleTitle,
      foundUsefulInfo: false,
      interviewProcessText: '',
      roundsSummary: [],
      focusAreas: [],
      sourceUrls: [],
      confidence: 'none',
    };
  }

  // Deduplicate and validate search results
  const seenUrls = new Set<string>();
  const relevantItems: PublicSearchResultItem[] = [];

  for (const item of rawResults) {
    if (!item.url || !item.snippet) continue;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(item.url);
    } catch {
      continue; // Skip malformed URLs
    }

    const normalizedUrl = parsedUrl.origin + parsedUrl.pathname;
    if (seenUrls.has(normalizedUrl)) {
      continue;
    }
    seenUrls.add(normalizedUrl);

    // Check if snippet contains interview signals
    const lowerText = `${item.title} ${item.snippet}`.toLowerCase();
    const hasInterviewSignal = INTERVIEW_SIGNAL_KEYWORDS.some((kw) => lowerText.includes(kw));

    if (hasInterviewSignal) {
      relevantItems.push({
        title: item.title,
        url: item.url,
        snippet: sanitizeUntrustedSnippet(item.snippet),
      });
    }

    if (relevantItems.length >= maxSources) break;
  }

  // If no relevant results were found, return an honest empty result
  if (relevantItems.length === 0) {
    return {
      companyName: trimmedCompany,
      roleTitle,
      foundUsefulInfo: false,
      interviewProcessText: '',
      roundsSummary: [],
      focusAreas: [],
      sourceUrls: [],
      confidence: 'none',
    };
  }

  const snippets = relevantItems.map((r) => r.snippet);
  const roundsSummary = extractMentionedRounds(snippets);
  const focusAreas = extractFocusAreas(snippets);
  const sourceUrls = relevantItems.map((r) => r.url);

  // Determine confidence level honestly based on evidence density
  let confidence: InterviewResearchConfidence = 'low';
  if (relevantItems.length >= 3 && roundsSummary.length >= 2) {
    confidence = 'high';
  } else if (relevantItems.length >= 2 || roundsSummary.length >= 1) {
    confidence = 'medium';
  }

  const interviewProcessText = relevantItems
    .map((r) => `[Source: ${r.url}]\n${r.title}\n${r.snippet}`)
    .join('\n\n');

  return {
    companyName: trimmedCompany,
    roleTitle,
    foundUsefulInfo: true,
    interviewProcessText,
    roundsSummary,
    focusAreas,
    sourceUrls,
    confidence,
  };
}
