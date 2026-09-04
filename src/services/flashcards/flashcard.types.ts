import type { Requirement, Flashcard, Question } from '../../domain/kit.types.js';
import type { ILanguageModelClient } from '../llm/types.js';

export interface FlashcardGenerationInput {
  requirements: Requirement[];
  roleTitle?: string;
  questions?: Question[];
}

export interface FlashcardGenerationOptions {
  llmClient?: ILanguageModelClient;
  temperature?: number;
  maxRetries?: number;
  cardsPerRequirement?: number;
}

export type { Flashcard };
