import { describe, it } from 'node:test';
import assert from 'node:assert';
import { allocateSchedule, ScheduleError } from '../services/schedule/index.js';
import { scheduleSchema } from '../domain/kit.schema.js';
import type { Requirement, Question } from '../domain/kit.types.js';

describe('Deterministic Study Schedule Allocation (Phase 8)', () => {
  const reqR1: Requirement = {
    id: 'r1',
    text: '5+ years React experience',
    kind: 'technical',
    priority: 'must',
  };
  const reqR2: Requirement = {
    id: 'r2',
    text: 'Node.js and Express backend development',
    kind: 'technical',
    priority: 'must',
  };
  const reqR3: Requirement = {
    id: 'r3',
    text: 'Distributed systems and PostgreSQL architecture',
    kind: 'technical',
    priority: 'must',
  };
  const reqR4: Requirement = {
    id: 'r4',
    text: 'Mentoring junior engineers and team leadership',
    kind: 'behavioural',
    priority: 'must',
  };
  const reqR5Nice: Requirement = {
    id: 'r5',
    text: 'Kubernetes and Docker deployment',
    kind: 'technical',
    priority: 'nice',
  };
  const reqR6Nice: Requirement = {
    id: 'r6',
    text: 'Healthcare domain familiarity',
    kind: 'domain',
    priority: 'nice',
  };

  const sampleRequirements = [reqR1, reqR2, reqR3, reqR4, reqR5Nice, reqR6Nice];

  const sampleQuestions: Question[] = [
    {
      id: 'q1',
      requirement_ids: ['r3'],
      category: 'system-design',
      prompt: 'Design a distributed rate limiter with Redis and PostgreSQL.',
      answer_outline: 'Token bucket, sliding window, concurrency',
      difficulty: 3,
    },
    {
      id: 'q2',
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'Explain React Concurrent Mode, fiber architecture and scheduling.',
      answer_outline: 'Fiber tree, work in progress, priorities',
      difficulty: 3,
    },
    {
      id: 'q3',
      requirement_ids: ['r2'],
      category: 'technical',
      prompt: 'How do you handle stream backpressure and memory leaks in Node.js?',
      answer_outline: 'Stream pause/resume, highWaterMark, pipe',
      difficulty: 2,
    },
    {
      id: 'q4',
      requirement_ids: ['r4'],
      category: 'behavioural',
      prompt: 'Tell me about a time you mentored an engineer through a difficult technical blocker.',
      answer_outline: 'STAR framework: situation, action, positive growth',
      difficulty: 2,
    },
    {
      id: 'q5',
      requirement_ids: ['r5'],
      category: 'technical',
      prompt: 'How do you structure a multi-stage Dockerfile for a Next.js app?',
      answer_outline: 'Base, deps, builder, runner stages',
      difficulty: 1,
    },
    {
      id: 'q6',
      requirement_ids: ['r6'],
      category: 'company-fit',
      prompt: 'Why are you interested in working in the digital healthcare industry?',
      answer_outline: 'Mission alignment, compliance awareness, impact',
      difficulty: 1,
    },
    {
      id: 'q7',
      requirement_ids: ['r1', 'r2'],
      category: 'technical',
      prompt: 'Explain end-to-end SSR and hydration performance in full-stack TypeScript.',
      answer_outline: 'Server rendering, hydration mismatch, selective hydration',
      difficulty: 2,
    },
    {
      id: 'q8',
      requirement_ids: ['r2', 'r3'],
      category: 'technical',
      prompt: 'How do you optimize high-concurrency Node.js event loop latency under load?',
      answer_outline: 'Cluster module, worker threads, microtask queue starvation',
      difficulty: 3,
    },
  ];

  it('Requirement 1: Handles 1-day crash course schedule', () => {
    const schedule = allocateSchedule({
      requirements: sampleRequirements,
      questions: sampleQuestions,
      daysAvailable: 1,
    });

    assert.strictEqual(schedule.days_available, 1);
    assert.strictEqual(schedule.days.length, 1);
    assert.strictEqual(schedule.days[0].day, 1);
    assert.ok(schedule.days[0].focus.length > 0);
    assert.ok(schedule.days[0].question_ids.length >= sampleQuestions.length);
    assert.ok(Number.isInteger(schedule.days[0].minutes));
    assert.ok(schedule.days[0].minutes >= 60);

    // Appendix A validation check
    const validation = scheduleSchema.safeParse(schedule);
    assert.strictEqual(validation.success, true);
  });

  it('Requirement 2: Handles 2-day schedule with harder material earlier', () => {
    const schedule = allocateSchedule({
      requirements: sampleRequirements,
      questions: sampleQuestions,
      daysAvailable: 2,
    });

    assert.strictEqual(schedule.days_available, 2);
    assert.strictEqual(schedule.days.length, 2);
    assert.strictEqual(schedule.days[0].day, 1);
    assert.strictEqual(schedule.days[1].day, 2);

    // Day 1 should include difficulty 3 questions
    const day1Questions = schedule.days[0].question_ids.map(
      (id) => sampleQuestions.find((q) => q.id === id)!
    );
    const day2Questions = schedule.days[1].question_ids.map(
      (id) => sampleQuestions.find((q) => q.id === id)!
    );

    const day1AvgDiff =
      day1Questions.reduce((acc, q) => acc + q.difficulty, 0) / day1Questions.length;
    const day2AvgDiff =
      day2Questions.reduce((acc, q) => acc + q.difficulty, 0) / day2Questions.length;

    // Harder material lands earlier
    assert.ok(
      day1AvgDiff >= day2AvgDiff,
      `Day 1 avg difficulty (${day1AvgDiff}) should be >= Day 2 avg difficulty (${day2AvgDiff})`
    );

    // Both days have integer minutes
    assert.ok(Number.isInteger(schedule.days[0].minutes));
    assert.ok(Number.isInteger(schedule.days[1].minutes));
  });

  it('Requirement 3: Handles 5-day standard schedule', () => {
    const schedule = allocateSchedule({
      requirements: sampleRequirements,
      questions: sampleQuestions,
      daysAvailable: 5,
    });

    assert.strictEqual(schedule.days_available, 5);
    assert.strictEqual(schedule.days.length, 5);

    // Verify sequential day numbers
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(schedule.days[i].day, i + 1);
      assert.ok(schedule.days[i].question_ids.length > 0);
      assert.ok(schedule.days[i].focus.length > 0);
      assert.ok(Number.isInteger(schedule.days[i].minutes));
      assert.ok(schedule.days[i].minutes > 0);
    }

    const validation = scheduleSchema.safeParse(schedule);
    assert.strictEqual(validation.success, true);
  });

  it('Requirement 4: Handles 60-day schedule gracefully without empty days or lost questions', () => {
    const schedule = allocateSchedule({
      requirements: sampleRequirements,
      questions: sampleQuestions,
      daysAvailable: 60,
    });

    assert.strictEqual(schedule.days_available, 60);
    assert.strictEqual(schedule.days.length, 60);

    const knownQuestionIds = new Set(sampleQuestions.map((q) => q.id));

    for (let i = 0; i < 60; i++) {
      const day = schedule.days[i];
      assert.strictEqual(day.day, i + 1);
      assert.ok(day.question_ids.length > 0, `Day ${day.day} must have at least one question`);
      assert.ok(day.focus.length > 0, `Day ${day.day} must have a non-empty focus`);
      assert.ok(Number.isInteger(day.minutes), `Day ${day.day} minutes must be an integer`);
      assert.ok(day.minutes > 0, `Day ${day.day} minutes must be positive`);

      // All question IDs must reference valid existing questions
      for (const qId of day.question_ids) {
        assert.ok(
          knownQuestionIds.has(qId),
          `Day ${day.day} references unknown question ID ${qId}`
        );
      }
    }

    const validation = scheduleSchema.safeParse(schedule);
    assert.strictEqual(validation.success, true);
  });

  it('Requirement 5: Every must-have requirement appears somewhere in the schedule', () => {
    const mustReqIds = ['r1', 'r2', 'r3', 'r4'];

    const testDays = [1, 2, 3, 5, 10, 30, 60];
    for (const days of testDays) {
      const schedule = allocateSchedule({
        requirements: sampleRequirements,
        questions: sampleQuestions,
        daysAvailable: days,
      });

      // Collect all scheduled question IDs
      const allScheduledQuestionIds = new Set(schedule.days.flatMap((d) => d.question_ids));

      // Collect all requirements covered by scheduled questions
      const coveredRequirements = new Set<string>();
      for (const qId of allScheduledQuestionIds) {
        const q = sampleQuestions.find((item) => item.id === qId);
        if (q) {
          for (const reqId of q.requirement_ids) {
            coveredRequirements.add(reqId);
          }
        }
      }

      // Assert all must-haves are present
      for (const mustId of mustReqIds) {
        assert.ok(
          coveredRequirements.has(mustId),
          `Must-have requirement ${mustId} is missing from schedule for ${days} days`
        );
      }
    }
  });

  it('Requirement 6: Higher-priority and harder material is scheduled earlier', () => {
    const schedule = allocateSchedule({
      requirements: sampleRequirements,
      questions: sampleQuestions,
      daysAvailable: 4,
    });

    const day1Questions = schedule.days[0].question_ids.map(
      (id) => sampleQuestions.find((q) => q.id === id)!
    );
    const day4Questions = schedule.days[3].question_ids.map(
      (id) => sampleQuestions.find((q) => q.id === id)!
    );

    // Day 1 contains must-have questions
    const day1HasMustHave = day1Questions.some((q) =>
      q.requirement_ids.some((id) => ['r1', 'r2', 'r3', 'r4'].includes(id))
    );
    assert.strictEqual(day1HasMustHave, true);

    // Day 1 contains high difficulty (difficulty 3)
    const day1HasDiff3 = day1Questions.some((q) => q.difficulty === 3);
    assert.strictEqual(day1HasDiff3, true);

    // Day 4 questions have lower average difficulty than Day 1
    const day1AvgDiff =
      day1Questions.reduce((acc, q) => acc + q.difficulty, 0) / day1Questions.length;
    const day4AvgDiff =
      day4Questions.reduce((acc, q) => acc + q.difficulty, 0) / day4Questions.length;
    assert.ok(day1AvgDiff >= day4AvgDiff);
  });

  it('Requirement 7: Durations are strictly integer minutes (no floats, no fractional minutes)', () => {
    const schedule = allocateSchedule({
      requirements: sampleRequirements,
      questions: sampleQuestions,
      daysAvailable: 7,
    });

    for (const day of schedule.days) {
      assert.strictEqual(
        Number.isInteger(day.minutes),
        true,
        `Day ${day.day} minutes (${day.minutes}) must be an integer`
      );
      assert.strictEqual(day.minutes % 1, 0);
      assert.ok(day.minutes >= 20);
    }
  });

  it('Requirement 8: Every question_ids entry refers to an existing question', () => {
    const schedule = allocateSchedule({
      requirements: sampleRequirements,
      questions: sampleQuestions,
      daysAvailable: 14,
    });

    const validIds = new Set(sampleQuestions.map((q) => q.id));
    for (const day of schedule.days) {
      for (const qId of day.question_ids) {
        assert.ok(validIds.has(qId), `Question ID ${qId} does not exist in sampleQuestions`);
      }
    }
  });

  it('Requirement 9: Exact number of days matches requested days across range', () => {
    const daysToTest = [1, 2, 3, 7, 14, 21, 30, 45, 60];

    for (const d of daysToTest) {
      const schedule = allocateSchedule({
        requirements: sampleRequirements,
        questions: sampleQuestions,
        daysAvailable: d,
      });

      assert.strictEqual(schedule.days_available, d);
      assert.strictEqual(schedule.days.length, d);
      assert.strictEqual(schedule.days[0].day, 1);
      assert.strictEqual(schedule.days[d - 1].day, d);
    }
  });

  it('Edge case & error handling: Rejects invalid daysAvailable or empty questions', () => {
    // 0 days
    assert.throws(() => {
      allocateSchedule({
        requirements: sampleRequirements,
        questions: sampleQuestions,
        daysAvailable: 0,
      });
    }, ScheduleError);

    // Negative days
    assert.throws(() => {
      allocateSchedule({
        requirements: sampleRequirements,
        questions: sampleQuestions,
        daysAvailable: -5,
      });
    }, ScheduleError);

    // Float days
    assert.throws(() => {
      allocateSchedule({
        requirements: sampleRequirements,
        questions: sampleQuestions,
        daysAvailable: 3.5,
      });
    }, ScheduleError);

    // Empty questions
    assert.throws(() => {
      allocateSchedule({
        requirements: sampleRequirements,
        questions: [],
        daysAvailable: 5,
      });
    }, ScheduleError);
  });
});
