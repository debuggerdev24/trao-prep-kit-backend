import type { InterviewKit, Question, QuestionCategory } from '../../domain/kit.types.js';
import type { ILanguageModelClient } from '../llm/types.js';
import type { CrawlerOptions } from '../crawler/crawler.types.js';

export type RegenerateSectionType = 'company_brief' | 'schedule' | 'category' | 'flashcards';

export interface RegenerateSectionInput {
  kit: InterviewKit;
  section: RegenerateSectionType;
  category?: QuestionCategory;
}

export interface RegenerationOptions {
  llmClient?: ILanguageModelClient;
  crawlerOptions?: CrawlerOptions;
}

export interface RegenerateSectionResult {
  kit: InterviewKit;
  regeneratedSection: RegenerateSectionType;
  preservedItemsCount: number;
  replacedItemsCount: number;
}
