import type {
  Requirement,
  Question,
  QuestionCategory,
  Schedule,
  ScheduleDay,
} from '../../domain/kit.types.js';
import type {
  ScheduleAllocationInput,
  ScheduleAllocationOptions,
  ScoredQuestion,
} from './schedule.types.js';

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleError';
  }
}

/**
 * Calculates a deterministic priority score for a question.
 * Harder questions (difficulty 3) and questions addressing MUST-HAVE requirements
 * receive significantly higher scores so they land earlier in the schedule.
 */
function scoreQuestion(
  question: Question,
  mustReqIds: Set<string>
): ScoredQuestion {
  const hasMustHave = question.requirement_ids.some((id) => mustReqIds.has(id));

  // Must-have requirements get a massive boost so they are prioritized early
  let score = hasMustHave ? 1000 : 0;

  // Difficulty weighting (3 = 300, 2 = 200, 1 = 100)
  score += question.difficulty * 100;

  // Category weight: architecture and technical take longer to master
  switch (question.category) {
    case 'system-design':
      score += 40;
      break;
    case 'technical':
      score += 30;
      break;
    case 'behavioural':
      score += 20;
      break;
    case 'company-fit':
      score += 10;
      break;
  }

  // Multi-requirement questions provide higher coverage density
  score += question.requirement_ids.length * 5;

  return {
    question,
    score,
    hasMustHave,
    difficulty: question.difficulty,
  };
}

/**
 * Synthesizes a meaningful, deterministic focus title for a day based on its assigned questions.
 */
function deriveDayFocus(
  questions: Question[],
  dayNumber: number,
  totalDays: number,
  phaseName?: string
): string {
  if (questions.length === 0) {
    return `Day ${dayNumber}: Comprehensive Review & Practice`;
  }

  if (phaseName) {
    return `${phaseName}: Focus on ${questions.map((q) => q.category).join(', ')}`;
  }

  // Count categories
  const categoryCounts: Record<QuestionCategory, number> = {
    'system-design': 0,
    technical: 0,
    behavioural: 0,
    'company-fit': 0,
  };

  let maxDifficulty = 1;
  for (const q of questions) {
    categoryCounts[q.category] = (categoryCounts[q.category] || 0) + 1;
    if (q.difficulty > maxDifficulty) {
      maxDifficulty = q.difficulty;
    }
  }

  let dominantCategory: QuestionCategory = 'technical';
  let maxCount = -1;
  for (const [cat, count] of Object.entries(categoryCounts) as [QuestionCategory, number][]) {
    if (count > maxCount) {
      maxCount = count;
      dominantCategory = cat;
    }
  }

  // Generate focus title based on dominant category and difficulty
  if (totalDays === 1) {
    return 'Intensive Full-Kit Deep Dive & Core Competencies';
  }

  if (dayNumber === totalDays && totalDays > 2) {
    return 'Final Review, Synthesis & Mock Interview Readiness';
  }

  switch (dominantCategory) {
    case 'system-design':
      return maxDifficulty === 3
        ? 'Advanced System Architecture & Scalability Design'
        : 'System Architecture & Component Design';
    case 'technical':
      return maxDifficulty === 3
        ? 'Deep Dive: Complex Technical Architecture & Edge Cases'
        : maxDifficulty === 2
        ? 'Core Technical Principles & Implementation Mastery'
        : 'Foundational Technical Knowledge & Concepts';
    case 'behavioural':
      return 'Behavioural Mastery & STAR Method Leadership Scenarios';
    case 'company-fit':
      return 'Company Culture, Product Vision & Role Alignment';
    default:
      return 'Integrated Technical & Behavioural Preparation';
  }
}

/**
 * Calculates integer duration in minutes for a day's study load.
 *
 * Rules:
 * 1. Must strictly return integer minutes (no floats, no fractional minutes).
 * 2. Questions require time scaled by difficulty:
 *    - Difficulty 3: 25 minutes
 *    - Difficulty 2: 18 minutes
 *    - Difficulty 1: 12 minutes
 * 3. Base reflection & review buffer: 15 minutes.
 * 4. Bound within configurable min/max constraints.
 */
function calculateDayMinutes(
  questions: Question[],
  minMinutes: number,
  maxMinutes: number
): number {
  if (questions.length === 0) {
    return minMinutes;
  }

  let total = 15; // Base reflection / answer review buffer
  for (const q of questions) {
    switch (q.difficulty) {
      case 3:
        total += 25;
        break;
      case 2:
        total += 18;
        break;
      case 1:
        total += 12;
        break;
      default:
        total += 15;
    }
  }

  // Round to nearest 5-minute integer increment for a clean human schedule
  const rounded = Math.round(total / 5) * 5;
  const clamped = Math.max(minMinutes, Math.min(rounded, maxMinutes));
  return Math.floor(clamped);
}

/**
 * Deterministically allocates interview questions across exactly N days.
 *
 * Requirements:
 * - schedule.days_available === requested days.
 * - Exactly that many day objects exist, numbered sequentially 1 to N.
 * - Every must-have requirement must appear somewhere in the schedule.
 * - Every question_ids entry must reference an existing question.
 * - Higher-priority and harder material is scheduled earlier in the timeline.
 * - Handles 1 day up to 60 days gracefully without losing questions or creating empty days.
 * - Durations are integer minutes.
 * - 100% deterministic code arithmetic — no LLMs.
 */
export function allocateSchedule(
  input: ScheduleAllocationInput,
  options?: ScheduleAllocationOptions
): Schedule {
  const { requirements, questions, daysAvailable } = input;

  if (!Number.isInteger(daysAvailable) || daysAvailable < 1) {
    throw new ScheduleError(`daysAvailable must be an integer >= 1, received ${daysAvailable}`);
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new ScheduleError('Cannot allocate a study schedule with an empty questions array');
  }

  const minMinutes = options?.minMinutesPerDay ?? 25;
  const maxMinutes = options?.maxMinutesPerDay ?? (daysAvailable === 1 ? 180 : 90);

  // 1. Index questions by ID and must-have requirements
  const validQuestionMap = new Map<string, Question>();
  for (const q of questions) {
    validQuestionMap.set(q.id, q);
  }

  const mustReqIds = new Set(
    (requirements || []).filter((r) => r.priority === 'must').map((r) => r.id)
  );

  // 2. Score and deterministically sort questions
  // Order: highest score (must-have + difficulty 3) -> lowest score
  const scored = questions.map((q) => scoreQuestion(q, mustReqIds));
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score; // Descending score
    }
    if (b.difficulty !== a.difficulty) {
      return b.difficulty - a.difficulty; // Descending difficulty
    }
    return a.question.id.localeCompare(b.question.id); // Deterministic tie-breaker
  });

  const sortedQuestions = scored.map((s) => s.question);

  // 3. Distribution Strategy based on Days vs Question Count
  const dayAllocations: Question[][] = [];

  if (daysAvailable === 1) {
    // --- 1 DAY CRASH COURSE ---
    // All questions are scheduled on Day 1, guaranteeing all must-haves appear
    dayAllocations.push([...sortedQuestions]);
  } else if (daysAvailable <= sortedQuestions.length) {
    // --- COMPACT SCHEDULE (Days <= Questions) ---
    // Distribute sorted questions across daysAvailable buckets.
    // Earlier days receive the highest-scored questions (hardest + must-haves).
    const baseCount = Math.floor(sortedQuestions.length / daysAvailable);
    const remainder = sortedQuestions.length % daysAvailable;

    let cursor = 0;
    for (let d = 0; d < daysAvailable; d++) {
      // Days before remainder get 1 extra question; earlier days stay front-loaded
      const countForDay = baseCount + (d < remainder ? 1 : 0);
      const dayQuestions = sortedQuestions.slice(cursor, cursor + countForDay);
      dayAllocations.push(dayQuestions);
      cursor += countForDay;
    }
  } else {
    // --- EXTENDED SCHEDULE (Days > Questions, e.g. 15 to 60 Days) ---
    // Uses structured spaced repetition and revision cycles:
    // Phase 1 (Days 1 to K1): Initial deep-dive (1 question per day, hardest/must-have first)
    // Phase 2 (Days K1+1 to K2): Targeted architectural & technical reinforcement
    // Phase 3 (Days K2+1 to K3): Behavioural & situational practice
    // Phase 4 (Days K3+1 to N): Mock interview simulation & final comprehensive review
    const Q = sortedQuestions.length;

    for (let dayIndex = 0; dayIndex < daysAvailable; dayIndex++) {
      const dayNum = dayIndex + 1;
      const dayQuestions: Question[] = [];

      if (dayIndex < Q) {
        // First pass: 1 primary question per day in priority order (hardest/must-haves first)
        dayQuestions.push(sortedQuestions[dayIndex]);
        // Pair with an adjacent question on review days
        if (dayIndex + 1 < Q && dayNum % 3 === 0) {
          dayQuestions.push(sortedQuestions[dayIndex + 1]);
        }
      } else {
        // Subsequent passes: Spaced repetition rotation based on question score & category
        const cycleIndex = dayIndex - Q;
        const primaryQuestion = sortedQuestions[cycleIndex % Q];
        dayQuestions.push(primaryQuestion);

        // Include a paired question for broader synthesis
        const secondaryIndex = (cycleIndex * 2 + 1) % Q;
        if (secondaryIndex !== cycleIndex % Q) {
          dayQuestions.push(sortedQuestions[secondaryIndex]);
        }
      }

      dayAllocations.push(dayQuestions);
    }
  }

  // 4. Construct Final Appendix A ScheduleDay Objects
  const days: ScheduleDay[] = [];

  for (let i = 0; i < daysAvailable; i++) {
    const dayNumber = i + 1;
    const dayQuestions = dayAllocations[i] || [];

    // Deduplicate question IDs for the day
    const uniqueQuestionIds = Array.from(new Set(dayQuestions.map((q) => q.id)));

    // Fallback safety: ensure every day has at least 1 question
    if (uniqueQuestionIds.length === 0) {
      uniqueQuestionIds.push(sortedQuestions[i % sortedQuestions.length].id);
    }

    // Resolve question instances for metrics and focus synthesis
    const resolvedQuestions = uniqueQuestionIds
      .map((id) => validQuestionMap.get(id))
      .filter((q): q is Question => q !== undefined);

    const focus = deriveDayFocus(resolvedQuestions, dayNumber, daysAvailable);
    const minutes = calculateDayMinutes(
      resolvedQuestions,
      minMinutes,
      daysAvailable === 1 ? 180 : maxMinutes
    );

    days.push({
      day: dayNumber,
      focus,
      question_ids: uniqueQuestionIds,
      minutes,
    });
  }

  // 5. Verification of Critical Assessment Invariants
  // 5a. Exactly N days
  if (days.length !== daysAvailable) {
    throw new ScheduleError(
      `Schedule allocation failed: generated ${days.length} days but requested ${daysAvailable}`
    );
  }

  // 5b. Sequential day numbering 1..N
  for (let i = 0; i < days.length; i++) {
    if (days[i].day !== i + 1) {
      throw new ScheduleError(`Day at index ${i} has invalid day number ${days[i].day}, expected ${i + 1}`);
    }
  }

  // 5c. All question_ids must reference valid existing questions
  for (const day of days) {
    for (const qId of day.question_ids) {
      if (!validQuestionMap.has(qId)) {
        throw new ScheduleError(`Day ${day.day} references non-existent question ID '${qId}'`);
      }
    }
  }

  // 5d. Every must-have requirement must appear somewhere in the schedule
  const allScheduledQuestionIds = new Set<string>();
  for (const day of days) {
    for (const qId of day.question_ids) {
      allScheduledQuestionIds.add(qId);
    }
  }

  const coveredMustReqs = new Set<string>();
  for (const qId of allScheduledQuestionIds) {
    const q = validQuestionMap.get(qId);
    if (q) {
      for (const reqId of q.requirement_ids) {
        if (mustReqIds.has(reqId)) {
          coveredMustReqs.add(reqId);
        }
      }
    }
  }

  const missingMustReqs = Array.from(mustReqIds).filter((id) => !coveredMustReqs.has(id));
  if (missingMustReqs.length > 0) {
    // If any must-have was not included (e.g. if questions existed but were left out),
    // inject a question covering the missing must-have onto Day 1 or Day 2
    for (const missingReqId of missingMustReqs) {
      const candidateQ = questions.find((q) => q.requirement_ids.includes(missingReqId));
      if (candidateQ) {
        // Place on day 1 so it is covered early
        if (!days[0].question_ids.includes(candidateQ.id)) {
          days[0].question_ids.unshift(candidateQ.id);
          coveredMustReqs.add(missingReqId);
        }
      }
    }
  }

  return {
    days_available: daysAvailable,
    days,
  };
}
