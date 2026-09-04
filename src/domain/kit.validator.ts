import { kitBaseSchema } from './kit.schema.js';
import type { InterviewKit, ValidationResult } from './kit.types.js';

export class KitValidationError extends Error {
  public readonly errors: string[];

  constructor(errors: string[]) {
    super(`Kit validation failed with ${errors.length} error(s):\n - ${errors.join('\n - ')}`);
    this.name = 'KitValidationError';
    this.errors = errors;
  }
}

/**
 * Deterministic validator for Interview Preparation Kits.
 * Strictly enforces Appendix A structural, type, and referential integrity rules.
 * Never relies on external services or LLMs.
 */
export function validateKit(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      errors: ['Kit data must be a non-null object'],
    };
  }

  // 1. Structural, Type, and Enum Validation via Zod
  const parseResult = kitBaseSchema.safeParse(data);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      errors.push(`[${path}] ${issue.message}`);
    }
  }

  // If top-level structure is fundamentally broken, return early with structural errors
  const kit = data as Partial<InterviewKit>;
  if (!kit.role?.requirements || !Array.isArray(kit.role.requirements) ||
      !kit.questions || !Array.isArray(kit.questions) ||
      !kit.flashcards || !Array.isArray(kit.flashcards) ||
      !kit.schedule?.days || !Array.isArray(kit.schedule.days) ||
      !kit.coverage?.uncovered_requirement_ids || !Array.isArray(kit.coverage.uncovered_requirement_ids)) {
    return {
      valid: false,
      errors,
    };
  }

  // 2. Stable ID Uniqueness Validation
  const requirementIds = new Set<string>();
  for (let i = 0; i < kit.role.requirements.length; i++) {
    const req = kit.role.requirements[i];
    if (req?.id) {
      if (requirementIds.has(req.id)) {
        errors.push(`Duplicate requirement ID: '${req.id}' at role.requirements[${i}]`);
      } else {
        requirementIds.add(req.id);
      }
    }
  }

  const questionIds = new Set<string>();
  for (let i = 0; i < kit.questions.length; i++) {
    const q = kit.questions[i];
    if (q?.id) {
      if (questionIds.has(q.id)) {
        errors.push(`Duplicate question ID: '${q.id}' at questions[${i}]`);
      } else {
        questionIds.add(q.id);
      }
    }
  }

  const flashcardIds = new Set<string>();
  for (let i = 0; i < kit.flashcards.length; i++) {
    const fc = kit.flashcards[i];
    if (fc?.id) {
      if (flashcardIds.has(fc.id)) {
        errors.push(`Duplicate flashcard ID: '${fc.id}' at flashcards[${i}]`);
      } else {
        flashcardIds.add(fc.id);
      }
    }
  }

  // 3. Referential Integrity Validation
  // 3a. Questions -> Requirements
  const coveredRequirementIds = new Set<string>();
  for (let i = 0; i < kit.questions.length; i++) {
    const q = kit.questions[i];
    if (Array.isArray(q?.requirement_ids)) {
      if (q.requirement_ids.length === 0) {
        errors.push(`Question '${q.id || i}' must reference at least one requirement in requirement_ids`);
      }
      for (const reqId of q.requirement_ids) {
        if (!requirementIds.has(reqId)) {
          errors.push(
            `Question '${q.id || i}' references non-existent requirement ID: '${reqId}'`
          );
        } else {
          coveredRequirementIds.add(reqId);
        }
      }
    }
  }

  // 3b. Flashcards -> Requirements
  for (let i = 0; i < kit.flashcards.length; i++) {
    const fc = kit.flashcards[i];
    if (Array.isArray(fc?.requirement_ids)) {
      if (fc.requirement_ids.length === 0) {
        errors.push(`Flashcard '${fc.id || i}' must reference at least one requirement in requirement_ids`);
      }
      for (const reqId of fc.requirement_ids) {
        if (!requirementIds.has(reqId)) {
          errors.push(
            `Flashcard '${fc.id || i}' references non-existent requirement ID: '${reqId}'`
          );
        }
      }
    }
  }

  // 3c. Schedule -> Questions
  for (let i = 0; i < kit.schedule.days.length; i++) {
    const day = kit.schedule.days[i];
    if (Array.isArray(day?.question_ids)) {
      for (const qId of day.question_ids) {
        if (!questionIds.has(qId)) {
          errors.push(
            `Schedule Day ${day.day ?? (i + 1)} references non-existent question ID: '${qId}'`
          );
        }
      }
    }
  }

  // 3d. Coverage -> Requirements
  const uncoveredSet = new Set<string>();
  for (const uncoveredId of kit.coverage.uncovered_requirement_ids) {
    if (!requirementIds.has(uncoveredId)) {
      errors.push(
        `coverage.uncovered_requirement_ids references non-existent requirement ID: '${uncoveredId}'`
      );
    } else {
      uncoveredSet.add(uncoveredId);
    }
  }

  // 4. Schedule Consistency Validation
  if (typeof kit.schedule.days_available === 'number') {
    if (kit.schedule.days_available !== kit.schedule.days.length) {
      errors.push(
        `schedule.days_available (${kit.schedule.days_available}) must equal schedule.days count (${kit.schedule.days.length})`
      );
    }
  }

  for (let i = 0; i < kit.schedule.days.length; i++) {
    const expectedDayNumber = i + 1;
    const actualDayNumber = kit.schedule.days[i]?.day;
    if (actualDayNumber !== expectedDayNumber) {
      errors.push(
        `Schedule day at index ${i} must have day = ${expectedDayNumber}, got ${actualDayNumber}`
      );
    }
  }

  // 5. Coverage Math & Logical Consistency
  // A requirement cannot be both covered by a question AND listed in uncovered_requirement_ids
  for (const reqId of uncoveredSet) {
    if (coveredRequirementIds.has(reqId)) {
      errors.push(
        `Coverage inconsistency: requirement '${reqId}' is listed in uncovered_requirement_ids but is covered by one or more questions`
      );
    }
  }

  // Any requirement not covered by any question MUST be listed in uncovered_requirement_ids
  for (const reqId of requirementIds) {
    if (!coveredRequirementIds.has(reqId) && !uncoveredSet.has(reqId)) {
      errors.push(
        `Coverage inconsistency: requirement '${reqId}' is not addressed by any question but is missing from coverage.uncovered_requirement_ids`
      );
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
  }

  return {
    valid: true,
    errors: [],
    kit: parseResult.data as InterviewKit,
  };
}

/**
 * Asserts that the provided data is a valid InterviewKit.
 * Throws KitValidationError if invalid.
 */
export function assertValidKit(data: unknown): asserts data is InterviewKit {
  const result = validateKit(data);
  if (!result.valid) {
    throw new KitValidationError(result.errors);
  }
}
