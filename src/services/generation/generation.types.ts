import { z } from 'zod';
import { questionCategorySchema, questionDifficultySchema } from '../../domain/kit.schema.js';
import type { Requirement, QuestionCategory, QuestionDifficulty } from '../../domain/kit.types.js';
import type { CompanyResearchResult } from '../crawler/crawler.types.js';
import type { PublicInterviewResearchResult } from '../interview-research/interview-research.types.js';

export const rawGeneratedQuestionSchema = z.object({
  requirement_ids: z.array(z.string().trim().min(1)),
  category: questionCategorySchema,
  prompt: z.string().trim().min(1, 'Question prompt must be a non-empty string'),
  answer_outline: z.union([
    z.string().trim().min(1, 'answer_outline cannot be empty'),
    z.array(z.string().trim().min(1)).min(1, 'answer_outline array cannot be empty'),
  ]),
  difficulty: questionDifficultySchema,
});

export const rawGeneratedQuestionsSchema = z.object({
  questions: z.array(rawGeneratedQuestionSchema),
});

export type RawGeneratedQuestion = z.infer<typeof rawGeneratedQuestionSchema>;

export interface QuestionGenerationOptions {
  llmClient?: import('../llm/types.js').ILanguageModelClient;
  temperature?: number;
  maxRetries?: number;
  questionsPerRequirement?: number;
}

export interface QuestionGenerationInput {
  requirements: Requirement[];
  roleTitle: string;
  roleSeniority: string;
  responsibilities: string[];
  companyResearch?: CompanyResearchResult;
  interviewResearch?: PublicInterviewResearchResult;
}

export type { Requirement, QuestionCategory, QuestionDifficulty };
