import { z } from 'zod';
import { UniversalLLMClient } from '../llm/client.js';
import type { ILanguageModelClient } from '../llm/types.js';
import { sanitizeJsonResponse } from '../extraction/extractor.service.js';
import { flashcardSchema } from '../../domain/kit.schema.js';
import type { Flashcard, Requirement } from '../../domain/kit.types.js';
import type {
  FlashcardGenerationInput,
  FlashcardGenerationOptions,
} from './flashcard.types.js';

const rawFlashcardSchema = z.object({
  requirement_ids: z.array(z.string().trim().min(1)),
  front: z.string().trim().min(1, 'Flashcard front cannot be empty'),
  back: z.string().trim().min(1, 'Flashcard back cannot be empty'),
});

const rawFlashcardsBatchSchema = z.object({
  flashcards: z.array(rawFlashcardSchema),
});

/**
 * Deterministic fallback generator that creates flashcards directly from requirements
 * without relying on an external model (resilient against network or rate-limit issues).
 */
function generateDeterministicFallbackFlashcards(
  requirements: Requirement[]
): Flashcard[] {
  return requirements.map((req, index) => {
    let front = '';
    let back = '';

    if (req.kind === 'technical') {
      front = `Key Technical Principles: ${req.text}`;
      back = `Demonstrate hands-on proficiency with ${req.text}. Be prepared to explain architecture decisions, trade-offs, scalability, and error-handling patterns.`;
    } else if (req.kind === 'behavioural') {
      front = `STAR Scenario: ${req.text}`;
      back = `Prepare a concise STAR example (Situation, Task, Action, Result) illustrating ${req.text}. Emphasize ownership, collaboration, and measurable impact.`;
    } else {
      front = `Domain Context: ${req.text}`;
      back = `Highlight relevant business and domain knowledge related to ${req.text}. Connect technical decisions to product value and business objectives.`;
    }

    return {
      id: `f${index + 1}`,
      front,
      back,
      requirement_ids: [req.id],
    };
  });
}

/**
 * Generates flashcards for the interview kit practice mode.
 * Strictly conforms to Appendix A structure (f1, f2, ...) and references valid requirement IDs.
 */
export async function generateFlashcards(
  input: FlashcardGenerationInput,
  options?: FlashcardGenerationOptions
): Promise<Flashcard[]> {
  const { requirements, roleTitle } = input;

  if (!requirements || requirements.length === 0) {
    return [];
  }

  const validReqIds = new Set(requirements.map((r) => r.id));
  const client: ILanguageModelClient = options?.llmClient || new UniversalLLMClient();
  const maxRetries = options?.maxRetries ?? 2;

  const systemPrompt = `You are an expert technical interview coach creating concise practice flashcards.
Target Role: ${roleTitle || 'Software Engineer'}

CRITICAL RULES:
1. Every flashcard MUST reference one or more valid requirement IDs from the provided list.
2. The "front" should be a focused concept question, scenario prompt, or rapid recall query.
3. The "back" should be a structured, concise model answer (key bullet points or clear summary).
4. Do NOT invent requirement IDs. Only use: ${Array.from(validReqIds).join(', ')}.
5. Return ONLY valid JSON matching:
{
  "flashcards": [
    {
      "requirement_ids": ["r1"],
      "front": "Question/Prompt",
      "back": "Key concepts and concise answer"
    }
  ]
}`;

  const userPrompt = `Generate practice flashcards for the following requirements:
${requirements.map((r) => `[${r.id}] ${r.text} (${r.kind}, ${r.priority})`).join('\n')}

Generate 1 to 2 high-impact flashcards per requirement.`;

  let responseText = '';
  let attempt = 0;
  let rawList: z.infer<typeof rawFlashcardSchema>[] = [];

  while (attempt <= maxRetries) {
    try {
      responseText = await client.complete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        {
          temperature: options?.temperature ?? 0.2,
          jsonMode: true,
        }
      );

      const sanitized = sanitizeJsonResponse(responseText);
      const parsed = JSON.parse(sanitized);

      const batchResult = rawFlashcardsBatchSchema.safeParse(parsed);
      if (batchResult.success) {
        rawList = batchResult.data.flashcards;
      } else if (Array.isArray(parsed)) {
        const arrayResult = rawFlashcardsBatchSchema.safeParse({ flashcards: parsed });
        if (arrayResult.success) {
          rawList = arrayResult.data.flashcards;
        }
      }

      if (rawList.length > 0) {
        break;
      }
      throw new Error('No flashcards could be parsed from output');
    } catch (err: unknown) {
      attempt++;
      if (attempt > maxRetries) {
        console.warn(
          `[Flashcard Generator] LLM generation/parsing failed after ${maxRetries} attempts, using deterministic fallback:`,
          err
        );
        return generateDeterministicFallbackFlashcards(requirements);
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));
    }
  }

  if (rawList.length === 0) {
    return generateDeterministicFallbackFlashcards(requirements);
  }

  // Filter requirement_ids and assign stable IDs f1, f2, ...
  const finalized: Flashcard[] = [];
  let counter = 1;

  for (const item of rawList) {
    const filteredReqIds = item.requirement_ids.filter((id) => validReqIds.has(id));
    if (filteredReqIds.length === 0) {
      continue;
    }

    const card: Flashcard = {
      id: `f${counter++}`,
      front: item.front.trim(),
      back: item.back.trim(),
      requirement_ids: filteredReqIds,
    };

    const validCheck = flashcardSchema.safeParse(card);
    if (validCheck.success) {
      finalized.push(card);
    }
  }

  // If all failed or no cards generated, fallback deterministically
  if (finalized.length === 0) {
    return generateDeterministicFallbackFlashcards(requirements);
  }

  return finalized;
}
