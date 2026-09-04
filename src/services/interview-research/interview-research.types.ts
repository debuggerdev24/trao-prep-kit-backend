import type { IPublicSearchProvider } from './provider.types.js';
import type { ILanguageModelClient } from '../llm/types.js';

export interface InterviewResearchOptions {
  searchProvider?: IPublicSearchProvider;
  llmClient?: ILanguageModelClient;
  maxSources?: number;
  timeoutMs?: number;
}

export type InterviewResearchConfidence = 'high' | 'medium' | 'low' | 'none';

export interface PublicInterviewResearchResult {
  companyName: string;
  roleTitle?: string;
  foundUsefulInfo: boolean;
  interviewProcessText: string;
  roundsSummary: string[];
  focusAreas: string[];
  sourceUrls: string[];
  confidence: InterviewResearchConfidence;
}
