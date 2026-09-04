import { z } from 'zod';
import type { Role, Question, QuestionCategory, QuestionDifficulty } from '../../domain/kit.types.js';
import type { CompanyResearchResult } from '../crawler/crawler.types.js';
import type { PublicInterviewResearchResult } from '../interview-research/interview-research.types.js';
import type { ILanguageModelClient } from '../llm/types.js';

export interface QuestionGenerationContext {
  role: Role;
  companyResearch?: Partial<CompanyResearchResult>;
  interviewResearch?: Partial<PublicInterviewResearchResult>;
}

export interface QuestionGenerationOptions {
  llmClient?: ILanguageModelClient;
  temperature?: number;
  maxRetries?: number;
  targetCountPerCategory?: number;
}

// Zod schema for single raw generated question before normalization
export const rawGeneratedQuestionSchema = z.object({
  requirement_ids: z.array(z.string()).min(1, 'Question must reference at least one requirement ID'),
  category: z.enum(['technical', 'behavioural', 'system-design', 'company-fit']),
  prompt: z.string().min(5, 'Prompt must be at least 5 characters'),
  answer_outline: z.union([z.string(), z.array(z.string())]),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const rawGeneratedQuestionsBatchSchema = z.object({
  questions: z.array(rawGeneratedQuestionSchema),
});

export type RawGeneratedQuestion = z.infer<typeof rawGeneratedQuestionSchema>;
