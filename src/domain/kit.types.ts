/**
 * Interview Preparation Kit - Domain Types
 * Strictly conforms to the assessment's Appendix A contract.
 */

export type RequirementKind = 'technical' | 'behavioural' | 'domain';
export type RequirementPriority = 'must' | 'nice';

export interface Requirement {
  id: string;
  text: string;
  kind: RequirementKind;
  priority: RequirementPriority;
}

export type QuestionCategory = 'technical' | 'behavioural' | 'system-design' | 'company-fit';
export type QuestionDifficulty = 1 | 2 | 3;

export type ItemStatus = 'generated' | 'edited' | 'manual';

export interface Question {
  id: string;
  requirement_ids: string[];
  category: QuestionCategory;
  prompt: string;
  answer_outline: string | string[];
  difficulty: QuestionDifficulty;
  item_status?: ItemStatus;
  isPinned?: boolean;
  isEdited?: boolean;
  isCustom?: boolean;
  version?: number;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  requirement_ids: string[];
  item_status?: ItemStatus;
  isPinned?: boolean;
  isEdited?: boolean;
  isCustom?: boolean;
  version?: number;
}

export interface ScheduleDay {
  day: number;
  focus: string;
  question_ids: string[];
  minutes: number;
}

export interface Schedule {
  days_available: number;
  days: ScheduleDay[];
}

export interface Coverage {
  uncovered_requirement_ids: string[];
  passes: number;
}

export interface Source {
  company: string;
  company_url: string;
  role: string;
  location: string;
  jd_chars: number;
  researched_at: string;
  pages_used: string[];
}

export interface CompanyBrief {
  summary: string;
  what_they_do: string;
  sources: string[];
  item_status?: ItemStatus;
  isEdited?: boolean;
  version?: number;
}

export interface Role {
  title: string;
  seniority: string;
  responsibilities: string[];
  requirements: Requirement[];
}

export interface InterviewKit {
  source: Source;
  company_brief: CompanyBrief;
  role: Role;
  questions: Question[];
  flashcards: Flashcard[];
  schedule: Schedule;
  coverage: Coverage;
  // Optional metadata useful for persistence/tracking
  id?: string;
  user_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ValidationSuccess {
  valid: true;
  errors: [];
  kit: InterviewKit;
}

export interface ValidationFailure {
  valid: false;
  errors: string[];
  kit?: never;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;
