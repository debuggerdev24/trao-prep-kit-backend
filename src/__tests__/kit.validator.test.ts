import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateKit, assertValidKit, KitValidationError } from '../domain/kit.validator.js';
import type { InterviewKit } from '../domain/kit.types.js';

function createValidKit(): InterviewKit {
  return {
    source: {
      company: 'Acme Corp',
      company_url: 'https://acme.example.com',
      role: 'Senior Full Stack Engineer',
      location: 'Remote, US',
      jd_chars: 2450,
      researched_at: '2026-09-03T10:00:00.000Z',
      pages_used: [
        'https://acme.example.com/about',
        'https://acme.example.com/careers',
      ],
    },
    company_brief: {
      summary: 'Acme Corp is an enterprise SaaS provider specializing in workflow automation.',
      what_they_do: 'Builds real-time distributed workflow automation platforms for Fortune 500 companies.',
      sources: ['https://acme.example.com/about', 'https://acme.example.com/press'],
    },
    role: {
      title: 'Senior Full Stack Engineer',
      seniority: 'Senior',
      responsibilities: [
        'Architect and scale cloud-native web services',
        'Lead technical design reviews and mentor junior developers',
      ],
      requirements: [
        {
          id: 'req-ts',
          text: '5+ years of TypeScript and Node.js backend development experience',
          kind: 'technical',
          priority: 'must',
        },
        {
          id: 'req-react',
          text: 'Strong proficiency in modern React and frontend state management',
          kind: 'technical',
          priority: 'must',
        },
        {
          id: 'req-collab',
          text: 'Demonstrated experience working across cross-functional remote teams',
          kind: 'behavioural',
          priority: 'nice',
        },
        {
          id: 'req-fintech',
          text: 'Prior domain knowledge in enterprise billing systems',
          kind: 'domain',
          priority: 'nice',
        },
      ],
    },
    questions: [
      {
        id: 'q-ts-eventloop',
        requirement_ids: ['req-ts'],
        category: 'technical',
        prompt: 'Explain the Node.js event loop phases and how setImmediate differs from process.nextTick.',
        answer_outline: [
          'Describe timers, I/O callbacks, idle/prepare, poll, check, close phases',
          'Explain microtask queue vs macrotask execution order',
        ],
        difficulty: 2,
      },
      {
        id: 'q-react-perf',
        requirement_ids: ['req-react'],
        category: 'technical',
        prompt: 'How would you diagnose and resolve unnecessary re-renders in a large React application?',
        answer_outline: 'Use React DevTools Profiler, useMemo, useCallback, and component splitting.',
        difficulty: 2,
      },
      {
        id: 'q-collab-conflict',
        requirement_ids: ['req-collab'],
        category: 'behavioural',
        prompt: 'Describe a situation where you had a strong technical disagreement with a colleague.',
        answer_outline: 'Use STAR method: situation, task, respectful data-driven compromise, result.',
        difficulty: 1,
      },
    ],
    flashcards: [
      {
        id: 'fc-eventloop',
        front: 'What phase of the Node event loop runs setImmediate callbacks?',
        back: 'The check phase.',
        requirement_ids: ['req-ts'],
      },
      {
        id: 'fc-reconciliation',
        front: 'What is React Fiber reconciliation?',
        back: 'The diffing algorithm that breaks rendering into interruptible units of work.',
        requirement_ids: ['req-react'],
      },
    ],
    schedule: {
      days_available: 3,
      days: [
        {
          day: 1,
          focus: 'Backend Foundations & Event Loop',
          question_ids: ['q-ts-eventloop'],
          minutes: 45,
        },
        {
          day: 2,
          focus: 'Frontend Architecture & Performance',
          question_ids: ['q-react-perf'],
          minutes: 45,
        },
        {
          day: 3,
          focus: 'Behavioural Alignment & Review',
          question_ids: ['q-collab-conflict'],
          minutes: 30,
        },
      ],
    },
    coverage: {
      uncovered_requirement_ids: ['req-fintech'],
      passes: 2,
    },
  };
}

describe('InterviewKit Domain Validator (Appendix A Contract)', () => {
  it('passes validation for a fully conformant kit', () => {
    const kit = createValidKit();
    const result = validateKit(kit);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
    assert.ok(result.kit);
    assert.strictEqual(result.kit.source.company, 'Acme Corp');

    // assertValidKit should not throw
    assert.doesNotThrow(() => assertValidKit(kit));
  });

  it('rejects non-object or null input', () => {
    assert.strictEqual(validateKit(null).valid, false);
    assert.strictEqual(validateKit('string').valid, false);
    assert.strictEqual(validateKit(undefined).valid, false);
  });

  it('rejects missing top-level sections', () => {
    const kit = createValidKit();
    // @ts-expect-error test invalid deletion
    delete kit.source;
    const result = validateKit(kit);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('source')));
  });

  describe('Stable ID Uniqueness', () => {
    it('rejects duplicate requirement IDs', () => {
      const kit = createValidKit();
      kit.role.requirements.push({
        id: 'req-ts', // duplicate
        text: 'Another typescript requirement',
        kind: 'technical',
        priority: 'nice',
      });
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("Duplicate requirement ID: 'req-ts'")));
    });

    it('rejects duplicate question IDs', () => {
      const kit = createValidKit();
      kit.questions.push({
        id: 'q-ts-eventloop', // duplicate
        requirement_ids: ['req-ts'],
        category: 'technical',
        prompt: 'Duplicate question prompt',
        answer_outline: 'Outline',
        difficulty: 1,
      });
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("Duplicate question ID: 'q-ts-eventloop'")));
    });

    it('rejects duplicate flashcard IDs', () => {
      const kit = createValidKit();
      kit.flashcards.push({
        id: 'fc-eventloop', // duplicate
        front: 'Front duplicate',
        back: 'Back duplicate',
        requirement_ids: ['req-ts'],
      });
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("Duplicate flashcard ID: 'fc-eventloop'")));
    });
  });

  describe('Referential Integrity', () => {
    it('rejects a question referencing an unknown requirement ID', () => {
      const kit = createValidKit();
      kit.questions[0].requirement_ids = ['unknown-req-999'];
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("references non-existent requirement ID: 'unknown-req-999'")));
    });

    it('rejects a flashcard referencing an unknown requirement ID', () => {
      const kit = createValidKit();
      kit.flashcards[0].requirement_ids = ['unknown-req-888'];
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("references non-existent requirement ID: 'unknown-req-888'")));
    });

    it('rejects schedule referencing an unknown question ID', () => {
      const kit = createValidKit();
      kit.schedule.days[0].question_ids = ['q-non-existent'];
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("references non-existent question ID: 'q-non-existent'")));
    });

    it('rejects coverage referencing an unknown requirement ID', () => {
      const kit = createValidKit();
      kit.coverage.uncovered_requirement_ids = ['req-fake'];
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("references non-existent requirement ID: 'req-fake'")));
    });
  });

  describe('Field Constraints & Enums', () => {
    it('rejects invalid difficulty (difficulty = 0 or 4 or float)', () => {
      const kitZero = createValidKit();
      // @ts-expect-error test invalid difficulty
      kitZero.questions[0].difficulty = 0;
      assert.strictEqual(validateKit(kitZero).valid, false);

      const kitFour = createValidKit();
      // @ts-expect-error test invalid difficulty
      kitFour.questions[0].difficulty = 4;
      assert.strictEqual(validateKit(kitFour).valid, false);

      const kitFloat = createValidKit();
      // @ts-expect-error test invalid difficulty
      kitFloat.questions[0].difficulty = 2.5;
      assert.strictEqual(validateKit(kitFloat).valid, false);
    });

    it('rejects non-integer or negative schedule minutes', () => {
      const kitFloat = createValidKit();
      kitFloat.schedule.days[0].minutes = 30.5;
      const resFloat = validateKit(kitFloat);
      assert.strictEqual(resFloat.valid, false);

      const kitNeg = createValidKit();
      kitNeg.schedule.days[0].minutes = -10;
      const resNeg = validateKit(kitNeg);
      assert.strictEqual(resNeg.valid, false);
    });

    it('rejects invalid requirement priority (e.g. "urgent")', () => {
      const kit = createValidKit();
      // @ts-expect-error test invalid priority
      kit.role.requirements[0].priority = 'urgent';
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
    });

    it('rejects invalid requirement kind (e.g. "soft-skills")', () => {
      const kit = createValidKit();
      // @ts-expect-error test invalid kind
      kit.role.requirements[0].kind = 'soft-skills';
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
    });

    it('rejects invalid question category', () => {
      const kit = createValidKit();
      // @ts-expect-error test invalid category
      kit.questions[0].category = 'trivia';
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
    });
  });

  describe('Schedule Consistency', () => {
    it('rejects when days_available does not match schedule.days.length', () => {
      const kit = createValidKit();
      kit.schedule.days_available = 5; // length is 3
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('must equal schedule.days count')));
    });

    it('rejects non-consecutive or non-sequential schedule day numbers', () => {
      const kit = createValidKit();
      kit.schedule.days[1].day = 4; // should be 2
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('must have day = 2, got 4')));
    });
  });

  describe('Coverage Consistency', () => {
    it('rejects when an uncovered requirement is actually covered by a question', () => {
      const kit = createValidKit();
      // req-ts is covered by q-ts-eventloop, but we also claim it is uncovered
      kit.coverage.uncovered_requirement_ids.push('req-ts');
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("requirement 'req-ts' is listed in uncovered_requirement_ids but is covered")));
    });

    it('rejects when a requirement is not covered by any question and missing from uncovered_requirement_ids', () => {
      const kit = createValidKit();
      // req-fintech is not covered by any question, so if we empty uncovered_requirement_ids it must fail
      kit.coverage.uncovered_requirement_ids = [];
      const result = validateKit(kit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("requirement 'req-fintech' is not addressed by any question but is missing from coverage")));
    });
  });

  describe('assertValidKit helper', () => {
    it('throws KitValidationError on invalid kit', () => {
      const kit = createValidKit();
      kit.schedule.days_available = 999;
      assert.throws(
        () => assertValidKit(kit),
        (err) => err instanceof KitValidationError && err.errors.length > 0
      );
    });
  });
});
