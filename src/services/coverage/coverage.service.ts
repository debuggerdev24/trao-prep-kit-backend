import type { Requirement, Question, Coverage } from '../../domain/kit.types.js';
import { generateQuestions } from '../generation/generation.service.js';
import type {
  CoverageCheckResult,
  CoverageGenerationInput,
  CoverageGenerationOptions,
  CoverageGenerationResult,
} from './coverage.types.js';

export class CoverageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CoverageError';
  }
}

export class MustHaveCoverageError extends CoverageError {
  constructor(
    public readonly uncoveredMustIds: string[],
    public readonly passes: number
  ) {
    super(
      `Failed to achieve 100% must-have requirement coverage after ${passes} passes. Uncovered must-haves: [${uncoveredMustIds.join(', ')}]`
    );
    this.name = 'MustHaveCoverageError';
  }
}

/**
 * Pure, deterministic function to evaluate requirement coverage against a question bank.
 *
 * CRITICAL CONTRACT RULES:
 * 1. An LLM is NEVER consulted to determine whether coverage exists.
 * 2. Coverage is NEVER based on semantic similarity — requirement IDs are the sole source of truth.
 * 3. A requirement is covered if and only if at least one question explicitly references its ID.
 * 4. Invalid question requirement IDs (e.g. referencing 'r99' which does not exist in requirements)
 *    are strictly ignored and do not count toward coverage.
 */
export function checkCoverage(
  requirements: Requirement[],
  questions: Question[]
): CoverageCheckResult {
  if (!requirements || requirements.length === 0) {
    return {
      covered_requirement_ids: [],
      uncovered_requirement_ids: [],
      uncovered_must_ids: [],
      uncovered_nice_ids: [],
      is_fully_covered: true,
      must_haves_covered: true,
      coverage_ratio: 1.0,
    };
  }

  // 1. Index all valid requirement IDs from the source requirements list
  const validRequirementsMap = new Map<string, Requirement>();
  for (const req of requirements) {
    validRequirementsMap.set(req.id, req);
  }

  // 2. Identify which valid requirement IDs are referenced by questions
  const coveredSet = new Set<string>();
  if (Array.isArray(questions)) {
    for (const q of questions) {
      if (Array.isArray(q?.requirement_ids)) {
        for (const reqId of q.requirement_ids) {
          // Strictly ignore any hallucinated or invalid requirement IDs not in the requirements list
          if (validRequirementsMap.has(reqId)) {
            coveredSet.add(reqId);
          }
        }
      }
    }
  }

  // 3. Partition requirements into covered and uncovered, and categorize priority
  const covered_requirement_ids: string[] = [];
  const uncovered_requirement_ids: string[] = [];
  const uncovered_must_ids: string[] = [];
  const uncovered_nice_ids: string[] = [];

  for (const req of requirements) {
    if (coveredSet.has(req.id)) {
      covered_requirement_ids.push(req.id);
    } else {
      uncovered_requirement_ids.push(req.id);
      if (req.priority === 'must') {
        uncovered_must_ids.push(req.id);
      } else {
        uncovered_nice_ids.push(req.id);
      }
    }
  }

  const is_fully_covered = uncovered_requirement_ids.length === 0;
  const must_haves_covered = uncovered_must_ids.length === 0;
  const coverage_ratio =
    requirements.length > 0 ? covered_requirement_ids.length / requirements.length : 1.0;

  return {
    covered_requirement_ids,
    uncovered_requirement_ids,
    uncovered_must_ids,
    uncovered_nice_ids,
    is_fully_covered,
    must_haves_covered,
    coverage_ratio,
  };
}

/**
 * Deduplicates questions by normalized prompt text and reassigns clean, sequential IDs: q1, q2, ...
 */
function normalizeAndReindexQuestions(questions: Question[]): Question[] {
  const seenPrompts = new Set<string>();
  const uniqueQuestions: Question[] = [];

  for (const q of questions) {
    const key = q.prompt.trim().toLowerCase();
    if (!seenPrompts.has(key)) {
      seenPrompts.add(key);
      uniqueQuestions.push(q);
    }
  }

  return uniqueQuestions.map((q, index) => ({
    ...q,
    id: `q${index + 1}`,
  }));
}

/**
 * Multi-pass question generation loop with deterministic coverage checking and gap closing.
 *
 * Flow:
 * 1. FIRST PASS:
 *    - Generate questions across all role requirements.
 *    - Perform deterministic coverage check.
 * 2. SECOND PASS (and subsequent passes up to maxPasses):
 *    - If uncovered requirements exist, extract them as gaps.
 *    - Run targeted question generation specifically for the missing requirements.
 *    - Combine and re-index questions.
 *    - Perform deterministic coverage check again.
 * 3. MAXIMUM PASS PROTECTION:
 *    - Never exceeds maxPasses (default: 2, max: 3-4) to prevent runaway loops.
 * 4. MUST-HAVE REQUIREMENT SAFETY:
 *    - If any must-have requirement remains uncovered after maxPasses, throws MustHaveCoverageError
 *      (unless throwOnUncoveredMustHaves is set to false).
 *    - Nice-to-have requirements may remain uncovered without aborting the run.
 */
export async function generateQuestionsWithCoverage(
  input: CoverageGenerationInput,
  options?: CoverageGenerationOptions
): Promise<CoverageGenerationResult> {
  const { role, companyResearch, interviewResearch } = input;
  const requirements = role?.requirements || [];

  if (requirements.length === 0) {
    const emptyCheck = checkCoverage([], []);
    return {
      questions: [],
      coverage: {
        uncovered_requirement_ids: [],
        passes: 1,
      },
      checkResult: emptyCheck,
    };
  }

  // Enforce sensible bounds on passes: minimum 1, default 2, capped at 4
  const maxPasses = Math.max(1, Math.min(options?.maxPasses ?? 2, 4));
  const throwOnUncoveredMustHaves = options?.throwOnUncoveredMustHaves ?? true;

  // --- PASS 1: Initial Question Generation ---
  let currentPass = 1;
  const pass1Questions = await generateQuestions(
    {
      requirements,
      roleTitle: role.title,
      roleSeniority: role.seniority,
      responsibilities: role.responsibilities,
      companyResearch,
      interviewResearch,
    },
    {
      llmClient: options?.llmClient,
      temperature: options?.temperature,
      maxRetries: options?.maxRetries,
      questionsPerRequirement: options?.questionsPerRequirement,
    }
  );

  let allQuestions = normalizeAndReindexQuestions(pass1Questions);
  let coverageCheck = checkCoverage(requirements, allQuestions);

  // --- SECOND PASS (and beyond): Targeted Gap Closing ---
  while (currentPass < maxPasses && coverageCheck.uncovered_requirement_ids.length > 0) {
    // If all requirements are covered, we have achieved complete coverage early
    if (coverageCheck.is_fully_covered) {
      break;
    }

    currentPass++;

    // Extract precisely the missing requirements
    const missingRequirements = requirements.filter((r) =>
      coverageCheck.uncovered_requirement_ids.includes(r.id)
    );

    if (missingRequirements.length === 0) {
      break;
    }

    // Generate targeted questions specifically for the uncovered requirements
    try {
      const targetedQuestions = await generateQuestions(
        {
          requirements: missingRequirements,
          roleTitle: role.title,
          roleSeniority: role.seniority,
          responsibilities: role.responsibilities,
          companyResearch,
          interviewResearch,
        },
        {
          llmClient: options?.llmClient,
          temperature: options?.temperature,
          maxRetries: options?.maxRetries,
          questionsPerRequirement: options?.questionsPerRequirement,
        }
      );

      // Merge newly generated targeted questions with existing questions
      allQuestions = normalizeAndReindexQuestions([...allQuestions, ...targetedQuestions]);
    } catch (err: unknown) {
      console.warn(
        `[Coverage Service] Warning: Pass ${currentPass} targeted generation encountered an error:`,
        err
      );
      // Do not crash the entire pipeline if a retry pass fails; check remaining coverage
    }

    // Re-run deterministic coverage check on the merged question set
    coverageCheck = checkCoverage(requirements, allQuestions);
  }

  // --- MUST-HAVE SAFETY CHECK ---
  if (!coverageCheck.must_haves_covered && throwOnUncoveredMustHaves) {
    throw new MustHaveCoverageError(coverageCheck.uncovered_must_ids, currentPass);
  }

  const coverage: Coverage = {
    uncovered_requirement_ids: coverageCheck.uncovered_requirement_ids,
    passes: currentPass,
  };

  return {
    questions: allQuestions,
    coverage,
    checkResult: coverageCheck,
  };
}
