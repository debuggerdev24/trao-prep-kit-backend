import type {
  Requirement,
  Question,
  Schedule,
  ScheduleDay,
} from '../../domain/kit.types.js';

/**
 * Input for the deterministic study schedule allocation algorithm.
 */
export interface ScheduleAllocationInput {
  /** All extracted role requirements (used to verify must-have coverage) */
  requirements: Requirement[];
  /** Question bank to be distributed across the available days */
  questions: Question[];
  /** Requested days before the interview (integer >= 1, e.g. 1 to 60) */
  daysAvailable: number;
}

/**
 * Configuration options for schedule allocation.
 */
export interface ScheduleAllocationOptions {
  /** Target daily study time in minutes (default: 60) */
  targetDailyMinutes?: number;
  /** Minimum minutes for any day (default: 20) */
  minMinutesPerDay?: number;
  /** Maximum minutes for any day (default: 180) */
  maxMinutesPerDay?: number;
}

/**
 * Internal scored representation of a question used for deterministic sorting.
 */
export interface ScoredQuestion {
  question: Question;
  score: number;
  hasMustHave: boolean;
  difficulty: number;
}

export type { Schedule, ScheduleDay };
