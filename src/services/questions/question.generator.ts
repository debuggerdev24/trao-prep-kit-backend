import { UniversalLLMClient } from '../llm/client.js';
import type { ILanguageModelClient } from '../llm/types.js';
import { sanitizeJsonResponse } from '../extraction/extractor.service.js';
import { buildCategoryPrompt } from './prompts.js';
import {
  rawGeneratedQuestionsBatchSchema,
  type QuestionGenerationContext,
  type QuestionGenerationOptions,
  type RawGeneratedQuestion,
} from './question.types.js';
import { questionSchema } from '../../domain/kit.schema.js';
import type { Question, QuestionCategory, Requirement } from '../../domain/kit.types.js';

export class QuestionGenerationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'QuestionGenerationError';
  }
}

function groupRequirementsByCategory(requirements: Requirement[]): Record<QuestionCategory, Requirement[]> {
  const technical: Requirement[] = [];
  const behavioural: Requirement[] = [];
  const systemDesign: Requirement[] = [];
  const companyFit: Requirement[] = [];

  for (const req of requirements) {
    if (req.kind === 'technical') {
      technical.push(req);

      // Identify system-design candidates based on architecture/backend/scale keywords
      if (/distributed|system|architecture|scale|scalability|microservice|database|api|queue|concurrency|cloud/i.test(req.text)) {
        systemDesign.push(req);
      }
    } else if (req.kind === 'behavioural') {
      behavioural.push(req);
      companyFit.push(req);
    } else if (req.kind === 'domain') {
      companyFit.push(req);
      technical.push(req);
    }
  }

  // Fallbacks if groups are empty: ensure every category has requirements to ground questions in
  if (systemDesign.length === 0 && technical.length > 0) {
    systemDesign.push(technical[0]);
  }
  if (behavioural.length === 0 && requirements.length > 0) {
    behavioural.push(requirements[0]);
  }
  if (companyFit.length === 0 && requirements.length > 0) {
    companyFit.push(requirements[0]);
  }

  return {
    'technical': technical.length > 0 ? technical : requirements,
    'behavioural': behavioural.length > 0 ? behavioural : requirements,
    'system-design': systemDesign.length > 0 ? systemDesign : requirements,
    'company-fit': companyFit.length > 0 ? companyFit : requirements,
  };
}

export async function generateCategoryQuestions(
  category: QuestionCategory,
  targetRequirements: Requirement[],
  roleTitle: string,
  seniority: string,
  client: ILanguageModelClient,
  options?: {
    companyContext?: string;
    interviewProcessContext?: string;
    temperature?: number;
    maxRetries?: number;
  }
): Promise<RawGeneratedQuestion[]> {
  const prompt = buildCategoryPrompt(
    category,
    targetRequirements,
    roleTitle,
    seniority,
    options?.companyContext,
    options?.interviewProcessContext
  );

  const maxRetries = options?.maxRetries ?? 2;
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= maxRetries) {
    try {
      const responseText = await client.complete(
        [
          { role: 'system', content: 'You are an expert technical interviewer producing JSON.' },
          { role: 'user', content: prompt },
        ],
        {
          temperature: options?.temperature ?? 0.2,
          jsonMode: true,
        }
      );

      const sanitized = sanitizeJsonResponse(responseText);
      const parsed: unknown = JSON.parse(sanitized);

      const parseResult = rawGeneratedQuestionsBatchSchema.safeParse(parsed);
      if (parseResult.success) {
        return parseResult.data.questions;
      }

      // If the LLM returned a bare array of questions rather than an object with { questions: [...] }
      if (Array.isArray(parsed)) {
        const arrayResult = rawGeneratedQuestionsBatchSchema.safeParse({ questions: parsed });
        if (arrayResult.success) {
          return arrayResult.data.questions;
        }
      }

      const issueSummary = parseResult.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`).join('; ');
      throw new Error(`Invalid question structure from model: ${issueSummary}`);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      attempt++;
      if (attempt > maxRetries) {
        throw new QuestionGenerationError(
          `Failed generating ${category} questions after ${maxRetries} retries: ${lastError.message}`,
          lastError
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));
    }
  }

  throw new QuestionGenerationError(`Failed generating ${category} questions: unknown error`);
}

export async function generateQuestions(
  context: QuestionGenerationContext,
  options?: QuestionGenerationOptions
): Promise<Question[]> {
  const role = context.role;
  if (!role || !role.requirements || role.requirements.length === 0) {
    throw new QuestionGenerationError('Cannot generate questions without role requirements');
  }

  const client = options?.llmClient || new UniversalLLMClient();
  const validRequirementIds = new Set(role.requirements.map((r) => r.id));

  // Build context strings from company & interview research
  let companyContext = '';
  if (context.companyResearch?.companyBrief) {
    companyContext = `Company: ${context.companyResearch.companyName || 'Target Company'}\nSummary: ${context.companyResearch.companyBrief.summary}\nWhat they do: ${context.companyResearch.companyBrief.what_they_do}`;
  }

  let interviewProcessContext = '';
  if (context.interviewResearch?.foundUsefulInfo) {
    interviewProcessContext = `Detected Rounds:\n${context.interviewResearch.roundsSummary?.join('\n') || 'Standard rounds'}\nFocus Areas: ${context.interviewResearch.focusAreas?.join(', ') || 'Core competence'}`;
  }

  // Deliberate category routing
  const groupedRequirements = groupRequirementsByCategory(role.requirements);
  const categoriesToGenerate: QuestionCategory[] = ['technical', 'behavioural', 'system-design', 'company-fit'];

  const rawQuestions: RawGeneratedQuestion[] = [];

  for (const category of categoriesToGenerate) {
    const targetReqs = groupedRequirements[category];
    if (targetReqs.length === 0) continue;

    try {
      const generated = await generateCategoryQuestions(
        category,
        targetReqs,
        role.title,
        role.seniority,
        client,
        {
          companyContext,
          interviewProcessContext,
          temperature: options?.temperature,
          maxRetries: options?.maxRetries,
        }
      );
      rawQuestions.push(...generated);
    } catch (err) {
      console.warn(`[Question Generator] Warning: failed generating category ${category}:`, err);
      // Continue to other categories rather than failing the whole set
    }
  }

  if (rawQuestions.length === 0) {
    throw new QuestionGenerationError('Model failed to generate any questions across all categories');
  }

  // Strict Referential Validation, Sanitization & Stable ID Assignment (q1, q2, ...)
  const finalizedQuestions: Question[] = [];
  const seenPrompts = new Set<string>();
  let questionCounter = 1;

  for (const raw of rawQuestions) {
    const normalizedPrompt = raw.prompt.trim();
    if (!normalizedPrompt || seenPrompts.has(normalizedPrompt.toLowerCase())) {
      continue;
    }

    // CRITICAL REQUIREMENT: Filter requirement_ids against the ACTUAL extracted requirements
    // Reject/strip any hallucinated requirement IDs invented by the model
    const filteredReqIds = raw.requirement_ids.filter((id) => validRequirementIds.has(id));

    if (filteredReqIds.length === 0) {
      // If the LLM hallucinated all IDs, do NOT let it invent references. Skip it or attach to first requirement.
      continue;
    }

    seenPrompts.add(normalizedPrompt.toLowerCase());

    const questionObj: Question = {
      id: `q${questionCounter++}`,
      requirement_ids: filteredReqIds,
      category: raw.category,
      prompt: normalizedPrompt,
      answer_outline: raw.answer_outline,
      difficulty: raw.difficulty,
    };

    // Assert conformity to Appendix A Question Schema
    const validated = questionSchema.safeParse(questionObj);
    if (validated.success) {
      finalizedQuestions.push(validated.data);
    }
  }

  if (finalizedQuestions.length === 0) {
    throw new QuestionGenerationError('No valid questions passed referential and structural validation');
  }

  return finalizedQuestions;
}
