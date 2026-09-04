import type {
  InterviewKit,
  Question,
  QuestionCategory,
  Requirement,
} from '../../domain/kit.types.js';
import { assertValidKit } from '../../domain/kit.validator.js';
import { checkCoverage } from '../coverage/coverage.service.js';
import { allocateSchedule } from '../schedule/schedule.service.js';
import { researchCompany } from '../crawler/crawler.service.js';
import { generateQuestions } from '../generation/generation.service.js';
import { generateFlashcards } from '../flashcards/flashcard.generator.js';
import type {
  RegenerateSectionInput,
  RegenerateSectionResult,
  RegenerationOptions,
} from './regeneration.types.js';

export class RegenerationError extends Error {
  constructor(message: string) {
    super(`[RegenerationError] ${message}`);
    this.name = 'RegenerationError';
  }
}

/**
 * Predicate to determine if an editable item (question, flashcard, etc.)
 * is user-protected and must survive regeneration.
 *
 * Rules:
 * - item_status === 'edited' -> User altered text/metadata -> MUST SURVIVE
 * - item_status === 'manual' -> User manually authored -> MUST SURVIVE
 * - isPinned === true        -> Explicitly pinned by user -> MUST SURVIVE
 * - isEdited === true        -> Edit flag active -> MUST SURVIVE
 * - isCustom === true        -> Custom flag active -> MUST SURVIVE
 */
export function isItemPreserved(item: Question): boolean {
  return (
    item.item_status === 'edited' ||
    item.item_status === 'manual' ||
    Boolean(item.isPinned) ||
    Boolean(item.isEdited) ||
    Boolean(item.isCustom)
  );
}

/**
 * Executes isolated section or category regeneration on an existing InterviewKit.
 * Strictly guarantees that user work (edits, manual questions, pinned items, reorderings)
 * is never overwritten or lost.
 */
export async function regenerateKitSection(
  input: RegenerateSectionInput,
  options?: RegenerationOptions
): Promise<RegenerateSectionResult> {
  const { kit: originalKit, section, category } = input;

  if (!originalKit) {
    throw new RegenerationError('Original kit must be provided');
  }

  // Deep clone to prevent accidental in-place corruption
  const kit: InterviewKit = JSON.parse(JSON.stringify(originalKit));

  let preservedItemsCount = 0;
  let replacedItemsCount = 0;

  switch (section) {
    case 'company_brief': {
      // Regenerate ONLY company_brief. Leave role, questions, flashcards, schedule untouched.
      const research = await researchCompany(kit.source.company_url, options?.crawlerOptions);

      kit.company_brief = {
        ...research.companyBrief,
        item_status: 'generated',
        isEdited: false,
        version: (kit.company_brief.version || 1) + 1,
      };

      if (research.pagesUsed && research.pagesUsed.length > 0) {
        kit.source.pages_used = Array.from(
          new Set([...(kit.source.pages_used || []), ...research.pagesUsed])
        );
      }
      break;
    }

    case 'schedule': {
      // Regenerate ONLY schedule. Leave company_brief, role, questions, flashcards untouched.
      kit.schedule = allocateSchedule({
        requirements: kit.role.requirements,
        questions: kit.questions,
        daysAvailable: kit.schedule.days_available,
      });
      break;
    }

    case 'category': {
      if (!category) {
        throw new RegenerationError('Category must be specified when section is "category"');
      }

      // 1. Separate questions into:
      //    a) Outside this category -> 100% preserved in exact original order
      //    b) Inside this category -> partitioned into preserved (edited/manual/pinned) vs replaceable (pure generated)
      const otherCategoryQuestions: { q: Question; originalIndex: number }[] = [];
      const targetCategoryQuestions: { q: Question; originalIndex: number }[] = [];

      kit.questions.forEach((q, idx) => {
        if (q.category !== category) {
          otherCategoryQuestions.push({ q, originalIndex: idx });
        } else {
          targetCategoryQuestions.push({ q, originalIndex: idx });
        }
      });

      const preservedTargetQuestions: Question[] = [];
      const replaceableTargetQuestions: Question[] = [];

      for (const entry of targetCategoryQuestions) {
        if (isItemPreserved(entry.q)) {
          preservedTargetQuestions.push(entry.q);
        } else {
          replaceableTargetQuestions.push(entry.q);
        }
      }

      preservedItemsCount = preservedTargetQuestions.length;
      replacedItemsCount = replaceableTargetQuestions.length;

      // 2. Identify relevant requirements for this category
      const targetRequirements = getRequirementsForCategory(kit.role.requirements, category);

      // 3. Generate candidate questions for the category
      const generatedCandidates = await generateQuestions(
        {
          requirements: targetRequirements.length > 0 ? targetRequirements : kit.role.requirements,
          roleTitle: kit.role.title,
          roleSeniority: kit.role.seniority,
          responsibilities: kit.role.responsibilities,
        },
        {
          llmClient: options?.llmClient,
          questionsPerRequirement: Math.max(1, Math.ceil((replacedItemsCount || 2) / Math.max(1, targetRequirements.length))),
        }
      );

      // Filter candidates matching the specific category and deduplicate against preserved prompts
      const preservedPrompts = new Set(
        preservedTargetQuestions.map((q) => q.prompt.trim().toLowerCase())
      );

      const validCategoryCandidates = generatedCandidates
        .filter((q) => q.category === category)
        .filter((q) => !preservedPrompts.has(q.prompt.trim().toLowerCase()))
        .map((q) => ({
          ...q,
          item_status: 'generated' as const,
          isPinned: false,
          isEdited: false,
          isCustom: false,
          version: 1,
        }));

      // Determine how many replacement candidates to take
      // If there were replaceable questions, replace up to that count (or at least 1)
      const countNeeded = Math.max(replaceableTargetQuestions.length, 1);
      const chosenCandidates = validCategoryCandidates.slice(0, countNeeded);

      // If generator produced fewer than needed, take all available
      const replacementQuestions = chosenCandidates.length > 0 ? chosenCandidates : validCategoryCandidates;

      // 4. Merge preserved questions with replacements
      // Preserved questions retain their exact relative order
      const mergedTargetQuestions = [...preservedTargetQuestions, ...replacementQuestions];

      // 5. Reassemble full question bank:
      // Other categories maintain their relative ordering!
      const mergedAllQuestions: Question[] = [];

      // Rebuild preserving original category groupings and orderings
      let targetInserted = false;
      for (const item of kit.questions) {
        if (item.category === category) {
          if (!targetInserted) {
            mergedAllQuestions.push(...mergedTargetQuestions);
            targetInserted = true;
          }
        } else {
          mergedAllQuestions.push(item);
        }
      }

      if (!targetInserted) {
        mergedAllQuestions.push(...mergedTargetQuestions);
      }

      // Re-index stable sequential IDs (q1, q2, ...)
      // Keep track of old ID -> new ID mapping to update schedule referential integrity
      const idMapping = new Map<string, string>();
      const finalQuestions: Question[] = mergedAllQuestions.map((q, idx) => {
        const newId = `q${idx + 1}`;
        if (q.id) {
          idMapping.set(q.id, newId);
        }
        return {
          ...q,
          id: newId,
        };
      });

      kit.questions = finalQuestions;

      // 6. Re-run coverage checking
      const covCheck = checkCoverage(kit.role.requirements, kit.questions);
      kit.coverage.uncovered_requirement_ids = covCheck.uncovered_requirement_ids;

      // 7. Re-synchronize schedule
      kit.schedule = allocateSchedule({
        requirements: kit.role.requirements,
        questions: kit.questions,
        daysAvailable: kit.schedule.days_available,
      });

      break;
    }

    case 'flashcards': {
      // Preserve user-owned cards, regenerate replacements for removed ones
      const preservedCards = kit.flashcards.filter((f) =>
        f.item_status === 'edited' || f.item_status === 'manual' || f.isPinned || f.isEdited || f.isCustom
      );
      const removedCount = kit.flashcards.length - preservedCards.length;
      preservedItemsCount = preservedCards.length;
      replacedItemsCount = removedCount;

      if (removedCount > 0) {
        // Generate replacement flashcards for the removed ones
        try {
          const newFlashcards = await generateFlashcards(
            {
              requirements: kit.role.requirements,
              roleTitle: kit.role.title,
            },
            { llmClient: options?.llmClient }
          );

          // Filter out any that duplicate preserved cards by front text
          const preservedFronts = new Set(
            preservedCards.map((f) => f.front.trim().toLowerCase())
          );
          const uniqueNewCards = newFlashcards.filter(
            (f) => !preservedFronts.has(f.front.trim().toLowerCase())
          );

          // Take only as many as were removed, then merge with preserved
          const replacementCards = uniqueNewCards.slice(0, removedCount);
          kit.flashcards = [...preservedCards, ...replacementCards];
        } catch {
          // If generation fails, keep only preserved cards
          kit.flashcards = preservedCards;
        }
      } else {
        kit.flashcards = preservedCards;
      }

      // Re-index stable IDs (f1, f2, ...)
      kit.flashcards = kit.flashcards.map((f, idx) => ({
        ...f,
        id: `f${idx + 1}`,
      }));
      break;
    }

    default:
      throw new RegenerationError(`Unsupported section type: ${section}`);
  }

  // 8. Enforce complete Appendix A contract validation
  assertValidKit(kit);

  return {
    kit,
    regeneratedSection: section,
    preservedItemsCount,
    replacedItemsCount,
  };
}

/**
 * Maps question category to relevant requirement kinds.
 */
function getRequirementsForCategory(
  requirements: Requirement[],
  category: QuestionCategory
): Requirement[] {
  return requirements.filter((r) => {
    if (category === 'technical') return r.kind === 'technical' || r.kind === 'domain';
    if (category === 'system-design') return r.kind === 'technical';
    if (category === 'behavioural') return r.kind === 'behavioural';
    if (category === 'company-fit') return true;
    return true;
  });
}
