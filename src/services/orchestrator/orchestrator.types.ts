import type { InterviewKit } from '../../domain/kit.types.js';
import type { ILanguageModelClient } from '../llm/types.js';
import type { CrawlerOptions } from '../crawler/crawler.types.js';
import type { InterviewResearchOptions } from '../interview-research/interview-research.types.js';

export type PipelineStage =
  | 'starting'
  | 'extracting_requirements'
  | 'researching_company'
  | 'finding_hiring_info'
  | 'searching_interview_info'
  | 'generating_questions'
  | 'checking_coverage'
  | 'filling_coverage_gaps'
  | 'generating_flashcards'
  | 'creating_schedule'
  | 'validating'
  | 'persisting'
  | 'complete'
  | 'failed';

export interface PipelineProgressEvent {
  stage: PipelineStage;
  step: number;
  totalSteps: number;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export type ProgressCallback = (event: PipelineProgressEvent) => void;

export interface GenerateKitInput {
  /** Raw job description pasted by user */
  jd: string;
  /** Company website address */
  company_url: string;
  /** Number of days before the interview (integer >= 1) */
  days: number;
  /** Optional ID of the user creating the kit (for DB ownership) */
  userId?: string;
  /** Optional progress callback for real-time streaming */
  onProgress?: ProgressCallback;
  /** Whether to persist to MongoDB (default: true if userId provided) */
  persist?: boolean;
}

export interface GenerateKitOptions {
  llmClient?: ILanguageModelClient;
  crawlerOptions?: CrawlerOptions;
  interviewResearchOptions?: InterviewResearchOptions;
  maxPasses?: number;
  allowLocalUrls?: boolean;
}

export interface GenerateKitResult {
  kit: InterviewKit;
  progressHistory: PipelineProgressEvent[];
}
