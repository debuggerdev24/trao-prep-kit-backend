import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  checkCoverage,
  generateQuestionsWithCoverage,
  MustHaveCoverageError,
} from '../services/coverage/index.js';
import { MockLanguageModelClient } from '../services/llm/mock.js';
import type { Requirement, Question, Role } from '../domain/kit.types.js';

function makeMockQuestionsResponse(questions: Array<{
  requirement_ids: string[];
  category: string;
  prompt: string;
  answer_outline: string | string[];
  difficulty: number;
}>) {
  return JSON.stringify({ questions });
}

describe('Deterministic Coverage Checking & Second Pass (Phase 7)', () => {
  const reqR1: Requirement = {
    id: 'r1',
    text: '5+ years of React experience',
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
    text: 'PostgreSQL database design and query optimization',
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
    text: 'Familiarity with Kubernetes and Docker deployment',
    kind: 'technical',
    priority: 'nice',
  };

  const sampleRole: Role = {
    title: 'Senior Full-Stack Engineer',
    seniority: 'Senior',
    responsibilities: ['Build full-stack applications', 'Design APIs', 'Optimize databases'],
    requirements: [reqR1, reqR2, reqR3, reqR5Nice],
  };

  describe('Part 1: checkCoverage Deterministic Function', () => {
    it('Case 1: All requirements covered', () => {
      const requirements = [reqR1, reqR2, reqR3];
      const questions: Question[] = [
        {
          id: 'q1',
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'Explain React reconciliation and fiber architecture.',
          answer_outline: 'Fiber tree, work in progress, commit phase',
          difficulty: 2,
        },
        {
          id: 'q2',
          requirement_ids: ['r2'],
          category: 'technical',
          prompt: 'How do you structure Express middleware for error handling?',
          answer_outline: 'Four arguments err, req, res, next',
          difficulty: 2,
        },
        {
          id: 'q3',
          requirement_ids: ['r3'],
          category: 'technical',
          prompt: 'How do you optimize slow queries in PostgreSQL?',
          answer_outline: 'EXPLAIN ANALYZE, indexing, query restructuring',
          difficulty: 3,
        },
      ];

      const result = checkCoverage(requirements, questions);

      assert.strictEqual(result.is_fully_covered, true);
      assert.strictEqual(result.must_haves_covered, true);
      assert.deepStrictEqual(result.uncovered_requirement_ids, []);
      assert.deepStrictEqual(result.uncovered_must_ids, []);
      assert.deepStrictEqual(result.uncovered_nice_ids, []);
      assert.deepStrictEqual(result.covered_requirement_ids, ['r1', 'r2', 'r3']);
      assert.strictEqual(result.coverage_ratio, 1.0);
    });

    it('Case 2: One requirement uncovered', () => {
      // Requirements: r1, r2, r3, r4. Questions: q1 -> r1, q2 -> r2, q3 -> r4. Uncovered: r3
      const requirements = [reqR1, reqR2, reqR3, reqR4];
      const questions: Question[] = [
        {
          id: 'q1',
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'React hooks deep dive.',
          answer_outline: 'Custom hooks, dependency array',
          difficulty: 2,
        },
        {
          id: 'q2',
          requirement_ids: ['r2'],
          category: 'technical',
          prompt: 'Node.js event loop explanation.',
          answer_outline: 'Phases of event loop, microtasks, macrotasks',
          difficulty: 2,
        },
        {
          id: 'q3',
          requirement_ids: ['r4'],
          category: 'behavioural',
          prompt: 'Tell me about a time you mentored a junior engineer.',
          answer_outline: 'Context, guidance provided, positive outcome',
          difficulty: 2,
        },
      ];

      const result = checkCoverage(requirements, questions);

      assert.strictEqual(result.is_fully_covered, false);
      assert.strictEqual(result.must_haves_covered, false);
      assert.deepStrictEqual(result.uncovered_requirement_ids, ['r3']);
      assert.deepStrictEqual(result.uncovered_must_ids, ['r3']);
      assert.deepStrictEqual(result.uncovered_nice_ids, []);
      assert.deepStrictEqual(result.covered_requirement_ids, ['r1', 'r2', 'r4']);
      assert.strictEqual(result.coverage_ratio, 0.75);
    });

    it('Case 3: Multiple requirements uncovered', () => {
      const requirements = [reqR1, reqR2, reqR3, reqR4, reqR5Nice];
      // Only r1 is covered by questions
      const questions: Question[] = [
        {
          id: 'q1',
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'React state management.',
          answer_outline: 'Zustand vs Redux',
          difficulty: 2,
        },
      ];

      const result = checkCoverage(requirements, questions);

      assert.strictEqual(result.is_fully_covered, false);
      assert.strictEqual(result.must_haves_covered, false);
      assert.deepStrictEqual(result.uncovered_requirement_ids, ['r2', 'r3', 'r4', 'r5']);
      assert.deepStrictEqual(result.uncovered_must_ids, ['r2', 'r3', 'r4']);
      assert.deepStrictEqual(result.uncovered_nice_ids, ['r5']);
      assert.deepStrictEqual(result.covered_requirement_ids, ['r1']);
      assert.strictEqual(result.coverage_ratio, 0.2);
    });

    it('Case 6: Nice-to-have requirement handling', () => {
      // Must-haves r1 and r2 covered; nice-to-have r5 uncovered
      const requirements = [reqR1, reqR2, reqR5Nice];
      const questions: Question[] = [
        {
          id: 'q1',
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'React questions',
          answer_outline: 'Answer outline',
          difficulty: 1,
        },
        {
          id: 'q2',
          requirement_ids: ['r2'],
          category: 'technical',
          prompt: 'Node questions',
          answer_outline: 'Answer outline',
          difficulty: 1,
        },
      ];

      const result = checkCoverage(requirements, questions);

      // Must-haves are covered, so must_haves_covered is true
      assert.strictEqual(result.must_haves_covered, true);
      // But overall is_fully_covered is false because r5 is missing
      assert.strictEqual(result.is_fully_covered, false);
      assert.deepStrictEqual(result.uncovered_requirement_ids, ['r5']);
      assert.deepStrictEqual(result.uncovered_must_ids, []);
      assert.deepStrictEqual(result.uncovered_nice_ids, ['r5']);
      assert.strictEqual(result.coverage_ratio, 2 / 3);
    });

    it('Case 7: Invalid question requirement ID (Anti-hallucination / strict verification)', () => {
      const requirements = [reqR1, reqR2];
      // Question references r999 (invalid) and fake_id (invalid), and q1 references r1
      const questions: Question[] = [
        {
          id: 'q1',
          requirement_ids: ['r1', 'r999'], // r999 does not exist
          category: 'technical',
          prompt: 'React prompt',
          answer_outline: 'React outline',
          difficulty: 1,
        },
        {
          id: 'q2',
          requirement_ids: ['fake_requirement_id'],
          category: 'technical',
          prompt: 'Fake prompt',
          answer_outline: 'Fake outline',
          difficulty: 1,
        },
      ];

      const result = checkCoverage(requirements, questions);

      // Only r1 should be considered covered; r2 must be uncovered
      assert.deepStrictEqual(result.covered_requirement_ids, ['r1']);
      assert.deepStrictEqual(result.uncovered_requirement_ids, ['r2']);
      assert.deepStrictEqual(result.uncovered_must_ids, ['r2']);
      assert.strictEqual(result.is_fully_covered, false);
      assert.strictEqual(result.must_haves_covered, false);
    });

    it('Edge case: Empty requirements list', () => {
      const result = checkCoverage([], []);
      assert.strictEqual(result.is_fully_covered, true);
      assert.strictEqual(result.must_haves_covered, true);
      assert.strictEqual(result.coverage_ratio, 1.0);
    });
  });

  describe('Part 2: generateQuestionsWithCoverage Multi-Pass Loop', () => {
    it('Case 4: Second pass closes the gap', async () => {
      // Setup role with r1 (must), r2 (must), r3 (must)
      const role: Role = {
        title: 'Senior Engineer',
        seniority: 'Senior',
        responsibilities: ['Development', 'Architecture'],
        requirements: [reqR1, reqR2, reqR3],
      };

      // Mock LLM Client:
      // Pass 1: returns questions covering r1 and r2, leaving r3 uncovered
      // Pass 2: user prompt contains r3 -> returns question covering r3
      const mockClient = new MockLanguageModelClient((messages, callCount) => {
        const userMessage = messages.find((m) => m.role === 'user')?.content || '';

        if (userMessage.includes('[r3]') && !userMessage.includes('[r1]')) {
          // Targeted Pass 2 for missing requirement r3
          return makeMockQuestionsResponse([
            {
              requirement_ids: ['r3'],
              category: 'technical',
              prompt: 'How do you design high-performance PostgreSQL indexes?',
              answer_outline: ['B-tree vs GIN indexes', 'Partial indexes'],
              difficulty: 3,
            },
          ]);
        }

        // Pass 1: covers only r1 and r2
        return makeMockQuestionsResponse([
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'Explain React useMemo and useCallback performance trade-offs.',
            answer_outline: ['Referential equality', 'Overhead of memoization'],
            difficulty: 2,
          },
          {
            requirement_ids: ['r2'],
            category: 'technical',
            prompt: 'How do you handle stream backpressure in Node.js?',
            answer_outline: ['Readable stream pause/resume', 'pipeline helper'],
            difficulty: 2,
          },
        ]);
      });

      const result = await generateQuestionsWithCoverage(
        { role },
        { llmClient: mockClient, maxPasses: 2 }
      );

      // Verify pass count is 2 and all gaps are closed
      assert.strictEqual(result.coverage.passes, 2);
      assert.deepStrictEqual(result.coverage.uncovered_requirement_ids, []);
      assert.strictEqual(result.checkResult.is_fully_covered, true);
      assert.strictEqual(result.checkResult.must_haves_covered, true);

      // Verify question IDs are cleanly sequenced: q1, q2, q3
      assert.strictEqual(result.questions.length, 3);
      assert.deepStrictEqual(
        result.questions.map((q) => q.id),
        ['q1', 'q2', 'q3']
      );

      // Verify questions collectively cover r1, r2, r3
      const allCoveredReqs = new Set(result.questions.flatMap((q) => q.requirement_ids));
      assert.strictEqual(allCoveredReqs.has('r1'), true);
      assert.strictEqual(allCoveredReqs.has('r2'), true);
      assert.strictEqual(allCoveredReqs.has('r3'), true);
    });

    it('Case 5: Second pass still fails (MustHaveCoverageError thrown)', async () => {
      const role: Role = {
        title: 'Senior Engineer',
        seniority: 'Senior',
        responsibilities: ['Development'],
        requirements: [reqR1, reqR2, reqR3],
      };

      // Mock LLM Client always only returns questions for r1, never covering r2 or r3
      const mockClient = new MockLanguageModelClient(() => {
        return makeMockQuestionsResponse([
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'React state hook question.',
            answer_outline: ['useState internals'],
            difficulty: 1,
          },
        ]);
      });

      await assert.rejects(
        async () => {
          await generateQuestionsWithCoverage(
            { role },
            { llmClient: mockClient, maxPasses: 2, throwOnUncoveredMustHaves: true }
          );
        },
        (err: unknown) => {
          assert.strictEqual(err instanceof MustHaveCoverageError, true);
          const covErr = err as MustHaveCoverageError;
          assert.strictEqual(covErr.passes, 2);
          assert.strictEqual(covErr.uncoveredMustIds.includes('r2'), true);
          assert.strictEqual(covErr.uncoveredMustIds.includes('r3'), true);
          return true;
        }
      );
    });

    it('Case 5b: Second pass fails on must-have, but throwOnUncoveredMustHaves is false', async () => {
      const role: Role = {
        title: 'Senior Engineer',
        seniority: 'Senior',
        responsibilities: ['Development'],
        requirements: [reqR1, reqR2],
      };

      // Mock LLM only returns r1
      const mockClient = new MockLanguageModelClient(() => {
        return makeMockQuestionsResponse([
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'React state question.',
            answer_outline: ['useState'],
            difficulty: 1,
          },
        ]);
      });

      const result = await generateQuestionsWithCoverage(
        { role },
        { llmClient: mockClient, maxPasses: 2, throwOnUncoveredMustHaves: false }
      );

      assert.strictEqual(result.coverage.passes, 2);
      assert.deepStrictEqual(result.coverage.uncovered_requirement_ids, ['r2']);
      assert.strictEqual(result.checkResult.must_haves_covered, false);
    });

    it('Case 6: Multi-pass loop allows uncovered nice-to-have requirements without throwing', async () => {
      // Role with r1 (must) and r5 (nice)
      const role: Role = {
        title: 'Frontend Engineer',
        seniority: 'Mid',
        responsibilities: ['UI Development'],
        requirements: [reqR1, reqR5Nice],
      };

      // Mock LLM only ever covers r1 (must), never covers r5 (nice)
      const mockClient = new MockLanguageModelClient(() => {
        return makeMockQuestionsResponse([
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'Explain React component lifecycle.',
            answer_outline: ['Mounting, updating, unmounting'],
            difficulty: 2,
          },
        ]);
      });

      // Even with throwOnUncoveredMustHaves = true, it should NOT throw because all must-haves are covered
      const result = await generateQuestionsWithCoverage(
        { role },
        { llmClient: mockClient, maxPasses: 2, throwOnUncoveredMustHaves: true }
      );

      assert.strictEqual(result.coverage.passes, 2);
      assert.deepStrictEqual(result.coverage.uncovered_requirement_ids, ['r5']);
      assert.strictEqual(result.checkResult.must_haves_covered, true);
      assert.strictEqual(result.checkResult.is_fully_covered, false);
      assert.deepStrictEqual(result.checkResult.uncovered_nice_ids, ['r5']);
    });

    it('Case 8: Maximum pass protection stops runaway loops', async () => {
      const role: Role = {
        title: 'Backend Engineer',
        seniority: 'Lead',
        responsibilities: ['Backend Development'],
        requirements: [reqR1, reqR2],
      };

      let invocationCount = 0;
      const mockClient = new MockLanguageModelClient(() => {
        invocationCount++;
        return makeMockQuestionsResponse([
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: `Question generated on call ${invocationCount}`,
            answer_outline: ['Outline'],
            difficulty: 1,
          },
        ]);
      });

      // Configured maxPasses: 2
      const result = await generateQuestionsWithCoverage(
        { role },
        { llmClient: mockClient, maxPasses: 2, throwOnUncoveredMustHaves: false }
      );

      // Loop must strictly terminate after 2 passes
      assert.strictEqual(result.coverage.passes, 2);
      // Ensure no more than 2 generation attempts were executed
      assert.strictEqual(invocationCount, 2);
    });

    it('Pass 1 complete coverage finishes in exactly 1 pass', async () => {
      const role: Role = {
        title: 'Full-Stack Developer',
        seniority: 'Mid',
        responsibilities: ['Full stack duties'],
        requirements: [reqR1, reqR2],
      };

      let invocationCount = 0;
      const mockClient = new MockLanguageModelClient(() => {
        invocationCount++;
        return makeMockQuestionsResponse([
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'React question.',
            answer_outline: ['React outline'],
            difficulty: 1,
          },
          {
            requirement_ids: ['r2'],
            category: 'technical',
            prompt: 'Node question.',
            answer_outline: ['Node outline'],
            difficulty: 1,
          },
        ]);
      });

      const result = await generateQuestionsWithCoverage(
        { role },
        { llmClient: mockClient, maxPasses: 3 }
      );

      // Since pass 1 achieved 100% coverage, it should terminate immediately with passes: 1
      assert.strictEqual(result.coverage.passes, 1);
      assert.strictEqual(invocationCount, 1);
      assert.strictEqual(result.checkResult.is_fully_covered, true);
    });
  });
});
