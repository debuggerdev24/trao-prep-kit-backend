import mongoose from 'mongoose';
import { extractRequirements } from '../extraction/extractor.service.js';
import { researchCompany } from '../crawler/crawler.service.js';
import { researchPublicInterviewProcess } from '../interview-research/interview-research.service.js';
import { generateQuestionsWithCoverage } from '../coverage/coverage.service.js';
import { generateFlashcards } from '../flashcards/flashcard.generator.js';
import { allocateSchedule } from '../schedule/schedule.service.js';
import { assertValidKit, validateKit } from '../../domain/kit.validator.js';
import { Kit } from '../../models/Kit.js';
import type { InterviewKit, Role, Question, Flashcard } from '../../domain/kit.types.js';
import type { CompanyResearchResult } from '../crawler/crawler.types.js';
import type { PublicInterviewResearchResult } from '../interview-research/interview-research.types.js';
import type {
  GenerateKitInput,
  GenerateKitOptions,
  GenerateKitResult,
  PipelineProgressEvent,
  PipelineStage,
} from './orchestrator.types.js';

export class OrchestratorError extends Error {
  constructor(message: string, public readonly stage?: PipelineStage, public readonly cause?: unknown) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

// In-flight request registry to prevent duplicate concurrent generation runs
const inFlightRequests = new Map<string, Promise<GenerateKitResult>>();

function buildIdempotencyKey(input: GenerateKitInput): string {
  const user = input.userId || 'anonymous';
  const url = input.company_url.trim().toLowerCase();
  const days = input.days;
  const jdSnippet = input.jd.trim().slice(0, 80).replace(/\s+/g, ' ');
  return `${user}:${url}:${days}:${jdSnippet}`;
}

/**
 * Creates an honest fallback CompanyResearchResult when a website is unreachable,
 * times out, or returns a 404.
 */
function createFallbackCompanyResearch(companyUrl: string, error?: string): CompanyResearchResult {
  let inferredName = 'Target Company';
  try {
    const parsed = new URL(companyUrl);
    const hostPart = parsed.hostname.replace(/^www\./, '').split('.')[0];
    if (hostPart) {
      inferredName = hostPart.charAt(0).toUpperCase() + hostPart.slice(1);
    }
  } catch {
    // Ignore URL parse error for name inference
  }

  return {
    companyUrl,
    companyName: inferredName,
    companyText: '',
    hiringText: '',
    sources: [companyUrl],
    pagesUsed: [companyUrl],
    hasHiringInfo: false,
    companyBrief: {
      summary: `Research was limited: company website was unreachable (${error || '404 or connection failure'}).`,
      what_they_do: 'No public website data could be retrieved during automated research.',
      sources: [companyUrl],
    },
  };
}

/**
 * Creates an honest fallback PublicInterviewResearchResult when no public discussion exists.
 */
function createFallbackInterviewResearch(companyName: string, roleTitle?: string): PublicInterviewResearchResult {
  return {
    companyName,
    roleTitle,
    foundUsefulInfo: false,
    interviewProcessText: '',
    roundsSummary: [],
    focusAreas: [],
    sourceUrls: [],
    confidence: 'none',
  };
}

/**
 * Full Interview Kit Generation Orchestrator.
 *
 * Coordinates the 12-step deliberate pipeline:
 * 1. Input validation & concurrency deduplication
 * 2. Role & requirement extraction from JD (anti-hallucination check)
 * 3. Company website crawl & research (with honest 404/failure fallback)
 * 4. Public interview-process search (with honest fallback)
 * 5. Company brief assembly
 * 6. Pass 1 question generation
 * 7. Deterministic coverage gap check
 * 8. Pass 2 targeted question generation for missing requirements
 * 9. Interactive flashcard generation
 * 10. Deterministic schedule allocation across exactly N days
 * 11. Complete Appendix A validation
 * 12. Database persistence
 */
export async function generateInterviewKit(
  input: GenerateKitInput,
  options?: GenerateKitOptions
): Promise<GenerateKitResult> {
  const idempotencyKey = buildIdempotencyKey(input);

  // Prevent duplicate generation from creating conflicting concurrent runs
  const existingRun = inFlightRequests.get(idempotencyKey);
  if (existingRun) {
    console.log(`[Orchestrator] Deduping duplicate concurrent request: ${idempotencyKey}`);
    return existingRun;
  }

  const executionPromise = (async () => {
    const progressHistory: PipelineProgressEvent[] = [];
    const totalSteps = 12;

    const emit = (stage: PipelineStage, step: number, message: string, data?: Record<string, unknown>) => {
      const event: PipelineProgressEvent = {
        stage,
        step,
        totalSteps,
        message,
        timestamp: new Date().toISOString(),
        data,
      };
      progressHistory.push(event);
      input.onProgress?.(event);
    };

    try {
      // 1. Validate Input
      emit('starting', 1, 'Initializing interview kit generation pipeline');

      const trimmedJD = input.jd?.trim();
      if (!trimmedJD) {
        throw new OrchestratorError('Job description text cannot be empty', 'starting');
      }

      const trimmedUrl = input.company_url?.trim();
      if (!trimmedUrl) {
        throw new OrchestratorError('Company URL cannot be empty', 'starting');
      }

      if (!Number.isInteger(input.days) || input.days < 1) {
        throw new OrchestratorError(`Days available must be an integer >= 1, received ${input.days}`, 'starting');
      }

      // 2. Extract Role and Requirements from JD
      emit('extracting_requirements', 2, 'Extracting role, responsibilities, and requirements from posting');
      const role: Role = await extractRequirements(trimmedJD, {
        llmClient: options?.llmClient,
      });

      // 3. Crawl / Research Company Website
      emit('researching_company', 3, `Crawling company website (${trimmedUrl}) for overview and business focus`);
      let companyResearch: CompanyResearchResult;
      try {
        companyResearch = await researchCompany(trimmedUrl, {
          allowLocal: options?.allowLocalUrls ?? (process.env.NODE_ENV !== 'production'),
          ...options?.crawlerOptions,
        });
      } catch (crawlerErr: unknown) {
        console.warn(`[Orchestrator] Crawler encountered error for ${trimmedUrl}, using fallback:`, crawlerErr);
        companyResearch = createFallbackCompanyResearch(
          trimmedUrl,
          crawlerErr instanceof Error ? crawlerErr.message : String(crawlerErr)
        );
      }

      // 4. Hiring Information Status
      if (companyResearch.hasHiringInfo) {
        emit('finding_hiring_info', 4, `Discovered hiring process information at: ${companyResearch.sources.join(', ')}`);
      } else {
        emit('finding_hiring_info', 4, 'No dedicated hiring or careers page found; proceeding with general brief');
      }

      // 5. Public Interview Process Research
      const companyNameForResearch = companyResearch.companyName || 'Target Company';
      emit('searching_interview_info', 5, `Searching public discussions for interview patterns at ${companyNameForResearch}`);
      let interviewResearch: PublicInterviewResearchResult;
      try {
        interviewResearch = await researchPublicInterviewProcess(
          companyNameForResearch,
          role.title,
          options?.interviewResearchOptions
        );
      } catch (researchErr: unknown) {
        console.warn('[Orchestrator] Public interview research error, using fallback:', researchErr);
        interviewResearch = createFallbackInterviewResearch(companyNameForResearch, role.title);
      }

      // 6. First Pass: Question Generation & Coverage Checking
      emit('generating_questions', 6, 'Generating targeted questions across categories based on requirements and research');
      emit('checking_coverage', 7, 'Running deterministic coverage check against extracted requirements');

      const coverageResult = await generateQuestionsWithCoverage(
        {
          role,
          companyResearch,
          interviewResearch,
        },
        {
          llmClient: options?.llmClient,
          maxPasses: options?.maxPasses ?? 2,
          throwOnUncoveredMustHaves: true,
        }
      );

      // Report gap closing if multiple passes ran
      if (coverageResult.coverage.passes > 1) {
        emit(
          'filling_coverage_gaps',
          8,
          `Second pass completed: closed coverage gaps across ${coverageResult.coverage.passes} passes`
        );
      } else {
        emit('filling_coverage_gaps', 8, 'Full requirement coverage achieved on first pass');
      }

      // 7. Flashcard Generation
      emit('generating_flashcards', 9, 'Generating interactive flashcards for practice mode');
      const flashcards = await generateFlashcards(
        {
          requirements: role.requirements,
          roleTitle: role.title,
          questions: coverageResult.questions,
        },
        {
          llmClient: options?.llmClient,
        }
      );

      // 8. Deterministic Schedule Allocation
      emit('creating_schedule', 10, `Allocating deterministic study plan across exactly ${input.days} days`);
      const schedule = allocateSchedule({
        requirements: role.requirements,
        questions: coverageResult.questions,
        daysAvailable: input.days,
      });

      // 9. Assemble Complete InterviewKit
      const pagesUsed = Array.from(
        new Set([
          ...(companyResearch.pagesUsed || []),
          ...(companyResearch.sources || []),
          ...(interviewResearch.sourceUrls || []),
        ])
      );

      const stampedQuestions: Question[] = coverageResult.questions.map((q) => ({
        ...q,
        item_status: q.item_status || 'generated',
        isPinned: q.isPinned ?? false,
        isEdited: q.isEdited ?? false,
        isCustom: q.isCustom ?? false,
        version: q.version || 1,
      }));

      const stampedFlashcards = flashcards.map((f) => ({
        ...f,
        item_status: f.item_status || 'generated',
        isPinned: f.isPinned ?? false,
        isEdited: f.isEdited ?? false,
        isCustom: f.isCustom ?? false,
        version: f.version || 1,
      }));

      const assembledKit: InterviewKit = {
        source: {
          company: companyResearch.companyName || 'Company',
          company_url: trimmedUrl,
          role: role.title,
          location: 'Remote / Flexible',
          jd_chars: trimmedJD.length,
          researched_at: new Date().toISOString(),
          pages_used: pagesUsed.length > 0 ? pagesUsed : [trimmedUrl],
        },
        company_brief: {
          ...companyResearch.companyBrief,
          item_status: 'generated',
          isEdited: false,
          version: 1,
        },
        role,
        questions: stampedQuestions,
        flashcards: stampedFlashcards,
        schedule,
        coverage: coverageResult.coverage,
      };

      // 10. Appendix A Contract Validation
      emit('validating', 11, 'Asserting complete Appendix A contract and referential integrity');
      assertValidKit(assembledKit);

      // 11. Persistence
      let persistedKit = assembledKit;
      if (input.userId && input.persist !== false) {
        emit('persisting', 12, 'Persisting interview kit to database');
        if (mongoose.connection.readyState === 1) {
          try {
            const userOid = mongoose.Types.ObjectId.isValid(input.userId)
              ? new mongoose.Types.ObjectId(input.userId)
              : new mongoose.Types.ObjectId();
            const savedDoc = await Kit.create({
              ...assembledKit,
              userId: userOid,
            });
            persistedKit = savedDoc.toJSON() as InterviewKit;
          } catch (dbErr: unknown) {
            console.error('[Orchestrator] Database save failed:', dbErr);
            // In case DB fails, continue returning the validated kit in-memory
          }
        }
      }

      emit('complete', 12, 'Interview preparation kit generated successfully!', {
        kitId: persistedKit.id,
        passes: coverageResult.coverage.passes,
        questionsCount: persistedKit.questions.length,
        flashcardsCount: persistedKit.flashcards.length,
      });

      return {
        kit: persistedKit,
        progressHistory,
      };
    } catch (err: unknown) {
      const stage: PipelineStage = err instanceof OrchestratorError ? err.stage || 'failed' : 'failed';
      emit('failed', totalSteps, `Pipeline failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  })();

  inFlightRequests.set(idempotencyKey, executionPromise);

  try {
    return await executionPromise;
  } finally {
    inFlightRequests.delete(idempotencyKey);
  }
}
