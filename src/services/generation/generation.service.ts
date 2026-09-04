import { UniversalLLMClient } from '../llm/client.js';
import type { ILanguageModelClient } from '../llm/types.js';
import {
  rawGeneratedQuestionsSchema,
  type QuestionGenerationOptions,
  type QuestionGenerationInput,
  type RawGeneratedQuestion,
} from './generation.types.js';
import { questionSchema } from '../../domain/kit.schema.js';
import type { Question, RequirementKind, QuestionCategory } from '../../domain/kit.types.js';
import { sanitizeJsonResponse } from '../extraction/extractor.service.js';

export class QuestionGenerationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'QuestionGenerationError';
  }
}

/**
 * Maps requirement kinds to their natural question categories.
 * A requirement can map to multiple relevant categories.
 */
const KIND_TO_CATEGORIES: Record<RequirementKind, QuestionCategory[]> = {
  technical: ['technical'],
  behavioural: ['behavioural'],
  domain: ['company-fit', 'system-design'],
};

/**
 * Builds category-specific system prompt segments.
 * Each category gets tailored instructions so the LLM generates
 * appropriate questions rather than generic ones.
 */
function buildCategoryInstructions(category: QuestionCategory, requirementKind: RequirementKind): string {
  switch (category) {
    case 'technical':
      return `Generate TECHNICAL interview questions for a ${requirementKind} requirement.
Focus on: implementation knowledge, practical experience, problem-solving with this technology.
Questions should test depth of hands-on experience, not just definitions.
Include scenario-based questions ("How would you...") and knowledge-check questions.`;

    case 'behavioural':
      return `Generate BEHAVIOURAL interview questions for a ${requirementKind} requirement.
Focus on: past experiences, leadership, teamwork, conflict resolution, mentoring.
Use STAR-method framing: "Tell me about a time when..." or "Describe a situation where...".
Questions should elicit specific examples, not hypothetical answers.`;

    case 'system-design':
      return `Generate SYSTEM DESIGN interview questions for a ${requirementKind} requirement.
Focus on: architecture decisions, trade-offs, scalability, distributed systems thinking.
Questions should present a design challenge that requires the candidate to think through components, data flow, and scaling.`;

    case 'company-fit':
      return `Generate COMPANY FIT interview questions for a ${requirementKind} requirement.
Focus on: alignment with company mission, cultural values, domain knowledge, motivation.
Questions should assess why this candidate wants to work at this specific company and how their background maps to the company's needs.`;
  }
}

/**
 * Builds the full system prompt for question generation.
 * Injects company research context when available.
 */
function buildSystemPrompt(
  input: QuestionGenerationInput,
  targetCategories: QuestionCategory[]
): string {
  const categoryList = targetCategories.map((c) => `- ${c}`).join('\n');

  let companyContext = '';
  if (input.companyResearch) {
    const cr = input.companyResearch;
    companyContext = `
COMPANY RESEARCH CONTEXT:
Company: ${cr.companyName || cr.companyUrl}
${cr.hasHiringInfo ? `Hiring process information found at: ${cr.sources.join(', ')}` : 'No specific hiring process information was found on the company site.'}
${cr.hiringText ? `Hiring details:\n${cr.hiringText.slice(0, 2000)}` : ''}
Company summary: ${cr.companyBrief.summary}
What they do: ${cr.companyBrief.what_they_do}`;
  }

  let interviewContext = '';
  if (input.interviewResearch && input.interviewResearch.foundUsefulInfo) {
    const ir = input.interviewResearch;
    const roundsList = ir.roundsSummary.length > 0
      ? `\nKnown interview rounds: ${ir.roundsSummary.join(', ')}`
      : '';
    const focusList = ir.focusAreas.length > 0
      ? `\nFocus areas to emphasize: ${ir.focusAreas.join(', ')}`
      : '';
    interviewContext = `
PUBLIC INTERVIEW RESEARCH:
Confidence: ${ir.confidence}
${ir.sourceUrls.length > 0 ? `Sources: ${ir.sourceUrls.join(', ')}` : ''}${roundsList}${focusList}`;
  }

  return `You are an expert interview coach generating targeted interview preparation questions.

CRITICAL RULES:
1. Generate questions that directly address the specific requirement text provided.
2. Each question MUST reference one or more EXACT requirement IDs from the provided list.
3. Do NOT invent or hallucinate requirement IDs. Only use IDs from the list given to you.
4. Match the question category to the requirement's nature (see categories below).
5. Vary difficulty across 1 (basic recall) to 3 (complex reasoning/scenario).
6. The answer_outline should be concise bullet points or a brief paragraph, not a full essay.
7. Questions should be specific to this role and company, not generic.

AVAILABLE REQUIREMENT IDs:
${input.requirements.map((r) => `[${r.id}] "${r.text}" (${r.kind}, ${r.priority})`).join('\n')}

TARGET CATEGORIES:
${categoryList}

ROLE: ${input.roleTitle} (${input.roleSeniority})
RESPONSIBILITIES: ${input.responsibilities.slice(0, 5).join('; ')}
${companyContext}${interviewContext}

OUTPUT FORMAT: Return ONLY valid JSON matching this structure:
{
  "questions": [
    {
      "requirement_ids": ["r1"],
      "category": "technical",
      "prompt": "The interview question text",
      "answer_outline": ["Key point 1", "Key point 2"],
      "difficulty": 2
    }
  ]
}`;
}

/**
 * Deduplicates questions by normalized prompt text.
 */
function deduplicateQuestions(questions: RawGeneratedQuestion[]): RawGeneratedQuestion[] {
  const seen = new Set<string>();
  const unique: RawGeneratedQuestion[] = [];

  for (const q of questions) {
    const key = q.prompt.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(q);
    }
  }

  return unique;
}


/**
 * Validates that all requirement_ids in generated questions reference known requirements.
 * Returns cleaned questions with invalid references removed.
 */
function validateAndCleanQuestions(
  rawQuestions: RawGeneratedQuestion[],
  knownRequirementIds: Set<string>
): RawGeneratedQuestion[] {
  const valid: RawGeneratedQuestion[] = [];

  for (const q of rawQuestions) {
    const validReqIds = q.requirement_ids.filter((id) => knownRequirementIds.has(id));

    if (validReqIds.length === 0) {
      console.warn(
        `[Question Generation] Discarded question "${q.prompt.slice(0, 60)}..." — none of its requirement_ids [${q.requirement_ids.join(', ')}] are valid`
      );
      continue;
    }

    valid.push({ ...q, requirement_ids: validReqIds });
  }

  return valid;
}

/**
 * Generates interview questions for a set of requirements.
 *
 * Consumes the actual outputs of earlier pipeline stages:
 * - Extracted job requirements (with stable IDs)
 * - Company research (optional, enhances company-fit and system-design questions)
 * - Role information
 *
 * Generates questions deliberately by requirement and category.
 * Validates all requirement references against known IDs.
 */
export async function generateQuestions(
  input: QuestionGenerationInput,
  options?: QuestionGenerationOptions
): Promise<Question[]> {
  const { requirements, roleTitle, roleSeniority, responsibilities, companyResearch, interviewResearch } = input;

  if (!requirements || requirements.length === 0) {
    throw new QuestionGenerationError('Cannot generate questions without requirements');
  }

  const client: ILanguageModelClient = options?.llmClient || new UniversalLLMClient();
  const knownRequirementIds = new Set(requirements.map((r) => r.id));
  const questionsPerReq = options?.questionsPerRequirement ?? 2;

  // Determine which categories are relevant based on requirement kinds
  const relevantKinds = new Set(requirements.map((r) => r.kind));
  const targetCategories = new Set<QuestionCategory>();

  for (const kind of relevantKinds) {
    for (const cat of KIND_TO_CATEGORIES[kind]) {
      targetCategories.add(cat);
    }
  }

  // If company has hiring info, boost company-fit relevance
  if (companyResearch?.hasHiringInfo) {
    targetCategories.add('company-fit');
  }

  const allCategories = Array.from(targetCategories);

  // Group requirements by kind for category-aware generation
  const requirementsByKind = new Map<RequirementKind, typeof requirements>();
  for (const req of requirements) {
    const existing = requirementsByKind.get(req.kind) || [];
    existing.push(req);
    requirementsByKind.set(req.kind, existing);
  }

  const allRawQuestions: RawGeneratedQuestion[] = [];
  const maxRetries = options?.maxRetries ?? 3;

  // Generate questions per kind-group, each with its natural category
  for (const [kind, kindReqs] of requirementsByKind) {
    const categories = KIND_TO_CATEGORIES[kind];

    for (const category of categories) {
      const systemPrompt = buildSystemPrompt(
        { requirements, roleTitle, roleSeniority, responsibilities, companyResearch, interviewResearch },
        [category]
      );

      const reqSummary = kindReqs
        .map((r) => `[${r.id}] ${r.text} (priority: ${r.priority})`)
        .join('\n');

      const userPrompt = `Generate ${questionsPerReq} ${category} interview question(s) for each of the following requirements:

${reqSummary}

Focus on the "${category}" category. Ensure each question directly tests knowledge or experience related to the requirement text. Vary difficulty between 1, 2, and 3.`;

      let responseContent = '';
      let attempt = 0;
      let lastError: Error | null = null;

      while (attempt <= maxRetries) {
        try {
          responseContent = await client.complete(
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            {
              temperature: options?.temperature ?? 0.2,
              jsonMode: true,
            }
          );

          // Parse & validate JSON inside the retry loop so malformed responses trigger retries
          const sanitized = sanitizeJsonResponse(responseContent);
          const parsedJson: unknown = JSON.parse(sanitized);

          const parseResult = rawGeneratedQuestionsSchema.safeParse(parsedJson);
          if (!parseResult.success) {
            const errorDetails = parseResult.error.issues
              .map((i) => `[${i.path.join('.')}] ${i.message}`)
              .join('; ');
            throw new QuestionGenerationError(
              `Generated questions failed validation for ${category}/${kind}: ${errorDetails}`
            );
          }

          allRawQuestions.push(...parseResult.data.questions);
          break;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          attempt++;

          if (attempt > maxRetries) {
            throw new QuestionGenerationError(
              `LLM question generation failed after ${maxRetries} retries (${category}/${kind}): ${lastError.message}`,
              lastError
            );
          }

          const delayMs = Math.min(50 * Math.pow(2, attempt), 1000);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
  }

  // Deduplicate by prompt text
  const deduplicated = deduplicateQuestions(allRawQuestions);

  // Validate requirement IDs and clean
  const validated = validateAndCleanQuestions(deduplicated, knownRequirementIds);

  if (validated.length === 0) {
    throw new QuestionGenerationError(
      'No valid questions were generated — all questions referenced non-existent requirement IDs'
    );
  }

  // Assign stable IDs and build final Question objects
  const questions: Question[] = validated.map((q, index) => ({
    id: `q${index + 1}`,
    requirement_ids: q.requirement_ids,
    category: q.category,
    prompt: q.prompt,
    answer_outline: q.answer_outline,
    difficulty: q.difficulty,
  }));

  // Final validation against canonical Appendix A questionSchema
  for (const q of questions) {
    const result = questionSchema.safeParse(q);
    if (!result.success) {
      const errorDetails = result.error.issues
        .map((i) => `[${i.path.join('.')}] ${i.message}`)
        .join('; ');
      throw new QuestionGenerationError(
        `Question ${q.id} failed Appendix A validation: ${errorDetails}`
      );
    }
  }

  return questions;
}
