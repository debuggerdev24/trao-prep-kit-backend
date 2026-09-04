import type {
  Requirement,
  Question,
  Role,
  Coverage,
} from '../../domain/kit.types.js';
import type { CompanyResearchResult } from '../crawler/crawler.types.js';
import type { PublicInterviewResearchResult } from '../interview-research/interview-research.types.js';
import type { ILanguageModelClient } from '../llm/types.js';

/**
 * Result of deterministic coverage checking.
 * Strictly computed in application logic by requirement IDs.
 */
export interface CoverageCheckResult {
  /** IDs of requirements that are referenced by at least one question */
  covered_requirement_ids: string[];
  /** IDs of all requirements that have 0 questions referencing them */
  uncovered_requirement_ids: string[];
  /** Subset of uncovered requirement IDs marked with priority: 'must' */
  uncovered_must_ids: string[];
  /** Subset of uncovered requirement IDs marked with priority: 'nice' */
  uncovered_nice_ids: string[];
  /** True if every single requirement is covered */
  is_fully_covered: boolean;
  /** True if all 'must' priority requirements are covered (nice-to-have may remain uncovered) */
  must_haves_covered: boolean;
  /** Ratio of covered requirements to total requirements (0.0 to 1.0) */
  coverage_ratio: number;
}

/**
 * Input to the coverage generation pipeline.
 */
export interface CoverageGenerationInput {
  role: Role;
  companyResearch?: CompanyResearchResult;
  interviewResearch?: PublicInterviewResearchResult;
}

/**
 * Configuration options for the multi-pass coverage generation loop.
 */
export interface CoverageGenerationOptions {
  /** Optional LLM client (defaults to UniversalLLMClient) */
  llmClient?: ILanguageModelClient;
  /**
   * Maximum generation passes allowed.
   * Default: 2 passes (Pass 1: initial generation, Pass 2: targeted gap closing).
   * Sensible maximum is typically 2 to 3.
   */
  maxPasses?: number;
  /** Temperature for LLM completions */
  temperature?: number;
  /** Number of retries per LLM request on network/rate-limit failure */
  maxRetries?: number;
  /** Number of questions to generate per requirement (default: 2) */
  questionsPerRequirement?: number;
  /**
   * Whether to throw MustHaveCoverageError if must-have requirements remain uncovered
   * after maxPasses. Default: true.
   */
  throwOnUncoveredMustHaves?: boolean;
}

/**
 * Final result produced by the multi-pass question generation loop.
 */
export interface CoverageGenerationResult {
  /** Complete list of questions with stable, unique IDs (q1, q2, ...) */
  questions: Question[];
  /** Appendix A compliant coverage structure */
  coverage: Coverage;
  /** Detailed breakdown of the final coverage check */
  checkResult: CoverageCheckResult;
}
