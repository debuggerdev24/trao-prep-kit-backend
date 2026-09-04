import { UniversalLLMClient, LLMError } from '../llm/client.js';
import type { ILanguageModelClient } from '../llm/types.js';
import {
  rawExtractedRoleSchema,
  type ExtractionOptions,
  type Role,
  type Requirement,
} from './extractor.types.js';
import { roleSchema } from '../../domain/kit.schema.js';

export class ExtractionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ExtractionError';
  }
}

/**
 * Sanitize user-supplied text to prevent prompt injection attacks.
 * Wraps the text in delimiters and strips known attack patterns.
 */
function sanitizeUserInput(text: string): string {
  return text
    .replace(/<\|im_start\|>|<\|im_end\|>/gi, '')
    .replace(/\[INST\]|\[\/INST\]/gi, '')
    .replace(/```(?:system|prompt)/gi, '```')
    .replace(/\b(ignore previous instructions|system prompt|developer mode|you are now|act as|pretend to be|forget everything|new instructions|override|disregard|bypass|jailbreak)\b/gi, '[redacted]');
}

const SYSTEM_EXTRACTION_PROMPT = `You are an expert technical recruiter and job description analyzer.
Your task is to analyze raw job description text and extract structured role details and requirements in strict JSON format.

CRITICAL RULES:
1. STRICT TRUTHFULNESS: Extract ONLY requirements and responsibilities directly stated or clearly implied by the text. NEVER invent, hallucinate, or extrapolate qualifications not mentioned in the posting.
2. SHORT / THIN DESCRIPTIONS: If the job description is only one or two lines, extract only the few facts available. Do not flesh it out or add standard boilerplate.
3. REQUIREMENT KIND:
   - "technical": Programming languages, libraries, frameworks, databases, cloud, architecture, tooling.
   - "behavioural": Soft skills, teamwork, mentoring, leadership, communication, conflict resolution.
   - "domain": Specific business sector or industry knowledge (e.g., healthcare, fintech, e-commerce, compliance).
4. PRIORITY CLASSIFICATION:
   - "must": Explicitly described as required, minimum, essential, "X+ years", or listed under required qualifications.
   - "nice": Described as preferred, bonus points, nice to have, plus, optional, or secondary.
5. JSON FORMAT: Return ONLY valid JSON matching this exact structure:
{
  "title": "Exact or inferred role title",
  "seniority": "Junior | Mid | Senior | Staff | Lead | Principal | Unknown",
  "responsibilities": ["Duty 1", "Duty 2"],
  "requirements": [
    {
      "text": "Specific requirement text",
      "kind": "technical" | "behavioural" | "domain",
      "priority": "must" | "nice"
    }
  ]
}`;

/**
 * Strips markdown code blocks and trims extraneous text to recover a clean JSON string.
 */
export function sanitizeJsonResponse(rawText: string): string {
  let cleaned = rawText.trim();

  // Strip ```json ... ``` or ``` ... ``` code blocks if present
  if (cleaned.includes('```')) {
    cleaned = cleaned.replace(/^[\s\S]*?```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```[\s\S]*$/, '');
  }

  // Find boundaries of outer JSON object or array
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let startIdx = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
  }

  if (startIdx !== -1) {
    cleaned = cleaned.substring(startIdx);
  }

  // Repair unescaped control characters and invalid backslash escapes inside string literals
  let repaired = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (inString) {
      if (escape) {
        escape = false;
        // Valid JSON single-character escapes: ", \, /, b, f, n, r, t
        if (/["\\/bfnrt]/.test(ch)) {
          repaired += '\\' + ch;
        } else if (ch === 'u') {
          // JSON unicode escape \uXXXX requires exactly 4 hex characters following it
          const nextFour = cleaned.substring(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(nextFour)) {
            repaired += '\\u';
          } else {
            // Not a valid unicode escape (e.g. \user, \url, \undefined), double escape to preserve text
            repaired += '\\\\u';
          }
        } else if (ch === "'") {
          // \' is invalid in standard JSON; replace with simple '
          repaired += "'";
        } else {
          // Other invalid escapes (e.g. \., \+, \s, \w, \d, Windows paths): double escape
          repaired += '\\\\' + ch;
        }
        continue;
      }

      if (ch === '\\') {
        escape = true;
        continue;
      }

      if (ch === '"') {
        inString = false;
        repaired += '"';
        continue;
      }

      // Convert raw unescaped control characters inside strings to standard JSON escapes
      if (ch === '\n') {
        repaired += '\\n';
      } else if (ch === '\r') {
        repaired += '\\r';
      } else if (ch === '\t') {
        repaired += '\\t';
      } else if (ch.charCodeAt(0) < 0x20) {
        repaired += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
      } else {
        repaired += ch;
      }
    } else {
      if (ch === '"') {
        inString = true;
        repaired += '"';
        continue;
      }
      repaired += ch;
    }
  }

  if (escape) {
    repaired += '\\\\';
  }

  cleaned = repaired;

  // Remove common LLM trailing comma artifacts: e.g. ", ]" or ", }"
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  // Also strip trailing comma at end of string (for truncated JSON like "Build",)
  cleaned = cleaned.replace(/,\s*$/, '');

  // Auto-repair truncated JSON: count unmatched braces/brackets and close them
  let braceCount = 0;
  let bracketCount = 0;
  inString = false;
  escape = false;

  for (const ch of cleaned) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') braceCount++;
    else if (ch === '}') braceCount--;
    else if (ch === '[') bracketCount++;
    else if (ch === ']') bracketCount--;
  }

  // If string was left open at truncation, close it
  if (inString) {
    cleaned += '"';
  }

  // Close any unclosed brackets first (innermost), then braces
  while (bracketCount > 0) {
    cleaned += ']';
    bracketCount--;
  }
  while (braceCount > 0) {
    cleaned += '}';
    braceCount--;
  }

  return cleaned.trim();
}

const STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'you', 'are', 'that', 'this', 'have', 'from',
  'will', 'must', 'should', 'about', 'all', 'any', 'can', 'our', 'what',
  'who', 'why', 'how', 'when', 'where', 'also', 'into', 'than', 'them', 'then',
  'years', 'year', 'experience', 'required', 'preferred', 'plus', 'need', 'needs',
]);

/**
 * Deterministic anti-hallucination guard.
 * Validates that an extracted requirement has factual lexical grounding in the raw JD text.
 */
export function verifyRequirementGrounding(requirementText: string, rawJD: string): boolean {
  const jdLower = rawJD.toLowerCase();
  const tokens = requirementText
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  if (tokens.length === 0) {
    return true; // Very short or entirely composed of common words
  }

  // Count matches of significant content tokens in the raw JD text
  const matchCount = tokens.filter((t) => jdLower.includes(t)).length;
  return matchCount >= 1;
}

/**
 * Service to extract structured role and requirement information from a raw job description string.
 */
export async function extractRequirements(
  jobDescription: string,
  options?: ExtractionOptions
): Promise<Role> {
  const trimmedJD = jobDescription?.trim() || '';

  if (!trimmedJD) {
    throw new ExtractionError('Cannot extract requirements from an empty job description');
  }

  const client: ILanguageModelClient = options?.llmClient || new UniversalLLMClient();

  const safeJD = sanitizeUserInput(trimmedJD);
  const userPrompt = `Job Description to analyze:\n"""\n${safeJD}\n"""\n\nExtract the structured role, responsibilities, and requirements in JSON.`;

  const maxRetries = options?.maxRetries ?? 3;
  let responseContent = '';
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= maxRetries) {
    try {
      responseContent = await client.complete(
        [
          { role: 'system', content: SYSTEM_EXTRACTION_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        {
          temperature: options?.temperature ?? 0.0,
          jsonMode: true,
        }
      );

      // Parse & validate JSON inside the retry loop so malformed responses trigger retries
      const sanitized = sanitizeJsonResponse(responseContent);
      const parsedJson: unknown = JSON.parse(sanitized);

      const parseResult = rawExtractedRoleSchema.safeParse(parsedJson);
      if (!parseResult.success) {
        const errorDetails = parseResult.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`).join('; ');
        throw new ExtractionError(`Extracted data failed validation: ${errorDetails}`);
      }

      // Success — fall through to post-loop processing below
      break;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      attempt++;

      if (attempt > maxRetries) {
        throw new ExtractionError(
          `LLM extraction request failed after ${maxRetries} retries: ${lastError.message}`,
          lastError
        );
      }

      // Exponential backoff with minimal delay in tests
      const delayMs = Math.min(50 * Math.pow(2, attempt), 1000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Re-parse to get the validated data for downstream processing
  const sanitized = sanitizeJsonResponse(responseContent);
  const parsedJson: unknown = JSON.parse(sanitized);
  const parseResult = rawExtractedRoleSchema.safeParse(parsedJson);
  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`).join('; ');
    throw new ExtractionError(`Extracted data failed validation: ${errorDetails}`);
  }

  const rawRole = parseResult.data;

  // 3. Fallback for extremely thin/stub JDs
  // Ensure at least one responsibility and at least one requirement exist to satisfy Appendix A
  const responsibilities = rawRole.responsibilities.length > 0
    ? rawRole.responsibilities
    : [`Fulfill core duties of ${rawRole.title || 'the role'} as outlined in posting`];

  let rawRequirements = rawRole.requirements;
  if (rawRequirements.length === 0) {
    // If the posting was so thin no requirements were parsed, provide an honest minimal requirement
    rawRequirements = [
      {
        text: `Experience relevant to ${rawRole.title} (${rawRole.seniority})`,
        kind: 'technical',
        priority: 'must',
      },
    ];
  }

  // 4. Deterministic Stable ID Assignment: r1, r2, r3...
  // Deduplicate requirements by normalized text and verify grounding in original JD text
  const seenTexts = new Set<string>();
  const requirements: Requirement[] = [];
  let reqCounter = 1;

  for (const rawReq of rawRequirements) {
    const normalizedText = rawReq.text.trim();
    if (!normalizedText || seenTexts.has(normalizedText.toLowerCase())) {
      continue;
    }

    // Code-level anti-hallucination check: ensure requirement has lexical grounding in raw JD
    const isGrounded = verifyRequirementGrounding(normalizedText, trimmedJD);
    if (!isGrounded) {
      console.warn(`[Anti-Hallucination Guard] Discarded ungrounded requirement: "${normalizedText}"`);
      continue;
    }

    seenTexts.add(normalizedText.toLowerCase());

    requirements.push({
      id: `r${reqCounter++}`,
      text: normalizedText,
      kind: rawReq.kind,
      priority: rawReq.priority,
    });
  }

  // Fallback if deduplication wiped everything out
  if (requirements.length === 0) {
    requirements.push({
      id: 'r1',
      text: `General qualifications for ${rawRole.title}`,
      kind: 'technical',
      priority: 'must',
    });
  }

  const role: Role = {
    title: rawRole.title,
    seniority: rawRole.seniority,
    responsibilities,
    requirements,
  };

  // 5. Validate the completed role against the canonical Appendix A roleSchema
  const finalValidation = roleSchema.safeParse(role);
  if (!finalValidation.success) {
    const errorDetails = finalValidation.error.issues
      .map((i) => `[${i.path.join('.')}] ${i.message}`)
      .join('; ');
    throw new ExtractionError(`Final role failed Appendix A validation: ${errorDetails}`);
  }

  return role;
}
