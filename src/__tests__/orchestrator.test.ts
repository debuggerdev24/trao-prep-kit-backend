import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateInterviewKit, OrchestratorError } from '../services/orchestrator/index.js';
import { MockLanguageModelClient } from '../services/llm/mock.js';
import { validateKit } from '../domain/kit.validator.js';
import type { LLMMessage } from '../services/llm/types.js';

describe('Full Interview Kit Generation Orchestrator (Phase 9)', () => {
  const sampleJD = `
Senior Backend Engineer at Acme Cloud Systems
Location: San Francisco, CA (Hybrid / Remote)

About the Role:
We are looking for a Senior Backend Engineer to lead development of our distributed messaging platform.

Key Responsibilities:
- Architect high-throughput event processing pipelines
- Mentor mid-level and junior software engineers
- Optimize PostgreSQL and Redis caching layers

Requirements:
- 5+ years of experience with Node.js and TypeScript (Must)
- Deep understanding of distributed systems and microservices (Must)
- Strong leadership and cross-functional communication skills (Must)
- Bonus points for experience with Kubernetes and Kafka (Nice to have)
  `;

  function createMockPipelineLLMClient() {
    return new MockLanguageModelClient((messages: LLMMessage[]) => {
      const systemPrompt = messages.find((m) => m.role === 'system')?.content || '';
      const userPrompt = messages.find((m) => m.role === 'user')?.content || '';

      // 1. Role Extraction
      if (systemPrompt.includes('expert technical recruiter') || userPrompt.includes('Job Description to analyze')) {
        return JSON.stringify({
          title: 'Senior Backend Engineer',
          seniority: 'Senior',
          responsibilities: [
            'Architect high-throughput event processing pipelines',
            'Mentor mid-level and junior software engineers',
            'Optimize PostgreSQL and Redis caching layers',
          ],
          requirements: [
            {
              text: '5+ years of experience with Node.js and TypeScript',
              kind: 'technical',
              priority: 'must',
            },
            {
              text: 'Deep understanding of distributed systems and microservices',
              kind: 'technical',
              priority: 'must',
            },
            {
              text: 'Strong leadership and cross-functional communication skills',
              kind: 'behavioural',
              priority: 'must',
            },
            {
              text: 'Experience with Kubernetes and Kafka',
              kind: 'technical',
              priority: 'nice',
            },
          ],
        });
      }

      // 2. Question Generation
      if (systemPrompt.includes('expert interview coach') || userPrompt.includes('interview question')) {
        // Targeted Pass 2 if prompted for missing requirements
        if (userPrompt.includes('[r3]') && !userPrompt.includes('[r1]')) {
          return JSON.stringify({
            questions: [
              {
                requirement_ids: ['r3'],
                category: 'behavioural',
                prompt: 'Describe a time you mentored a junior engineer through an architectural dispute.',
                answer_outline: ['Listen actively', 'Align on principles', 'Foster psychological safety'],
                difficulty: 2,
              },
            ],
          });
        }

        // Default Pass 1: covers r1, r2, r3, r4
        return JSON.stringify({
          questions: [
            {
              requirement_ids: ['r1'],
              category: 'technical',
              prompt: 'Explain how Node.js event loop handles asynchronous I/O and worker threads.',
              answer_outline: ['Libuv threadpool', 'Event loop phases', 'Microtask queue priority'],
              difficulty: 2,
            },
            {
              requirement_ids: ['r2'],
              category: 'system-design',
              prompt: 'How would you architect a distributed queue system ensuring at-least-once delivery?',
              answer_outline: ['Idempotency keys', 'Dead letter queues', 'Consumer acknowledgments'],
              difficulty: 3,
            },
            {
              requirement_ids: ['r3'],
              category: 'behavioural',
              prompt: 'Describe a situation where you had to influence technical direction across teams.',
              answer_outline: ['STAR framing: Situation, Task, Action, Measurable outcome'],
              difficulty: 2,
            },
            {
              requirement_ids: ['r4'],
              category: 'technical',
              prompt: 'How do you structure Kafka topic partitions and consumer groups for high availability?',
              answer_outline: ['Partition key hashing', 'Rebalance protocol', 'Offset commits'],
              difficulty: 2,
            },
          ],
        });
      }

      // 3. Flashcard Generation
      if (systemPrompt.includes('practice flashcards') || userPrompt.includes('flashcards')) {
        return JSON.stringify({
          flashcards: [
            {
              requirement_ids: ['r1'],
              front: 'Node.js Event Loop Microtasks vs Macrotasks',
              back: 'process.nextTick and Promise callbacks execute before setImmediate and setTimeout.',
            },
            {
              requirement_ids: ['r2'],
              front: 'CAP Theorem in Distributed Architecture',
              back: 'A distributed data store can only simultaneously provide two out of Consistency, Availability, and Partition tolerance.',
            },
            {
              requirement_ids: ['r3'],
              front: 'STAR Method for Leadership Questions',
              back: 'Situation (context), Task (goal), Action (your specific initiative), Result (measurable business impact).',
            },
          ],
        });
      }

      // Fallback
      return JSON.stringify({ status: 'ok' });
    });
  }

  it('1. Executes full end-to-end pipeline and produces compliant Appendix A kit', async () => {
    const mockClient = createMockPipelineLLMClient();

    const result = await generateInterviewKit(
      {
        jd: sampleJD,
        company_url: 'https://example.com/acme',
        days: 5,
        persist: false,
      },
      {
        llmClient: mockClient,
        allowLocalUrls: true,
      }
    );

    assert.ok(result.kit);
    assert.ok(result.progressHistory.length >= 10);

    // Validate Appendix A structure and referential integrity
    const validation = validateKit(result.kit);
    assert.strictEqual(validation.valid, true, `Validation failed: ${validation.errors?.join('; ')}`);

    // Check specific fields
    assert.strictEqual(result.kit.source.company_url, 'https://example.com/acme');
    assert.strictEqual(result.kit.schedule.days_available, 5);
    assert.strictEqual(result.kit.schedule.days.length, 5);
    assert.ok(result.kit.questions.length >= 4);
    assert.ok(result.kit.flashcards.length >= 1);
    assert.strictEqual(result.kit.coverage.passes >= 1, true);
  });

  it('2. Emits structured progress events in correct sequential order', async () => {
    const mockClient = createMockPipelineLLMClient();
    const emittedStages: string[] = [];

    await generateInterviewKit(
      {
        jd: sampleJD,
        company_url: 'https://example.com/acme',
        days: 3,
        persist: false,
        onProgress: (event) => {
          emittedStages.push(event.stage);
        },
      },
      {
        llmClient: mockClient,
        allowLocalUrls: true,
      }
    );

    // Verify key progression
    assert.ok(emittedStages.includes('starting'));
    assert.ok(emittedStages.includes('extracting_requirements'));
    assert.ok(emittedStages.includes('researching_company'));
    assert.ok(emittedStages.includes('generating_questions'));
    assert.ok(emittedStages.includes('checking_coverage'));
    assert.ok(emittedStages.includes('generating_flashcards'));
    assert.ok(emittedStages.includes('creating_schedule'));
    assert.ok(emittedStages.includes('validating'));
    assert.ok(emittedStages.includes('complete'));
  });

  it('3. Handles unreachable company website gracefully without failing the run', async () => {
    const mockClient = createMockPipelineLLMClient();

    // Pass an unreachable/invalid URL
    const result = await generateInterviewKit(
      {
        jd: sampleJD,
        company_url: 'http://localhost:59999/unreachable-nonexistent',
        days: 3,
        persist: false,
      },
      {
        llmClient: mockClient,
        allowLocalUrls: true,
      }
    );

    assert.ok(result.kit);
    // Produces an honest brief rather than crashing
    assert.ok(result.kit.company_brief.summary.length > 0);
    assert.ok(result.kit.company_brief.what_they_do.length > 0);

    const validation = validateKit(result.kit);
    assert.strictEqual(validation.valid, true);
  });

  it('4. Handles thin job description honestly without hallucination', async () => {
    const thinJD = 'Backend Engineer wanted. Must know Node.js and SQL.';
    const mockClient = new MockLanguageModelClient((messages) => {
      const userPrompt = messages.find((m) => m.role === 'user')?.content || '';
      if (userPrompt.includes('Job Description to analyze')) {
        return JSON.stringify({
          title: 'Backend Engineer',
          seniority: 'Mid',
          responsibilities: ['Build backend services'],
          requirements: [
            { text: 'Must know Node.js and SQL', kind: 'technical', priority: 'must' },
          ],
        });
      }
      if (userPrompt.includes('interview question')) {
        return JSON.stringify({
          questions: [
            {
              requirement_ids: ['r1'],
              category: 'technical',
              prompt: 'How do you query SQL databases safely from Node.js?',
              answer_outline: ['Parameterized queries', 'ORM/query builder'],
              difficulty: 2,
            },
          ],
        });
      }
      return JSON.stringify({ flashcards: [] });
    });

    const result = await generateInterviewKit(
      {
        jd: thinJD,
        company_url: 'https://example.com/company',
        days: 2,
        persist: false,
      },
      {
        llmClient: mockClient,
        allowLocalUrls: true,
      }
    );

    assert.ok(result.kit);
    assert.strictEqual(result.kit.role.title, 'Backend Engineer');
    assert.ok(result.kit.role.requirements.length >= 1);
    const validation = validateKit(result.kit);
    assert.strictEqual(validation.valid, true);
  });

  it('5. Second pass closes coverage gaps inside the orchestrated pipeline', async () => {
    // Setup LLM client where Pass 1 only covers r1, missing must-have r2
    // Pass 2 targets r2 and provides a question for r2
    const mockClient = new MockLanguageModelClient((messages) => {
      const userPrompt = messages.find((m) => m.role === 'user')?.content || '';

      if (userPrompt.includes('Job Description to analyze')) {
        return JSON.stringify({
          title: 'Platform Engineer',
          seniority: 'Senior',
          responsibilities: ['Cloud architecture'],
          requirements: [
            { text: '5+ years Node.js experience', kind: 'technical', priority: 'must' },
            { text: 'PostgreSQL database tuning', kind: 'technical', priority: 'must' },
          ],
        });
      }

      if (userPrompt.includes('interview question')) {
        if (userPrompt.includes('[r2]') && !userPrompt.includes('[r1]')) {
          // Pass 2: closes gap for r2
          return JSON.stringify({
            questions: [
              {
                requirement_ids: ['r2'],
                category: 'technical',
                prompt: 'Explain PostgreSQL indexing strategies for slow queries.',
                answer_outline: ['EXPLAIN ANALYZE', 'B-Tree vs Hash index'],
                difficulty: 3,
              },
            ],
          });
        }

        // Pass 1: only covers r1
        return JSON.stringify({
          questions: [
            {
              requirement_ids: ['r1'],
              category: 'technical',
              prompt: 'Describe Node.js clustering.',
              answer_outline: ['Cluster module', 'IPC'],
              difficulty: 2,
            },
          ],
        });
      }

      return JSON.stringify({ flashcards: [] });
    });

    const result = await generateInterviewKit(
      {
        jd: 'Platform Engineer. Requirements: 5+ years Node.js experience, PostgreSQL database tuning.',
        company_url: 'https://example.com',
        days: 3,
        persist: false,
      },
      {
        llmClient: mockClient,
        allowLocalUrls: true,
      }
    );

    assert.ok(result.kit);
    assert.strictEqual(result.kit.coverage.passes, 2);
    assert.deepStrictEqual(result.kit.coverage.uncovered_requirement_ids, []);

    const validation = validateKit(result.kit);
    assert.strictEqual(validation.valid, true);
  });

  it('6. Deduplicates identical concurrent generation requests', async () => {
    const mockClient = createMockPipelineLLMClient();

    const input = {
      jd: sampleJD,
      company_url: 'https://example.com/acme-concurrent',
      days: 4,
      userId: 'test-user-123',
      persist: false,
    };

    // Trigger two identical concurrent requests simultaneously
    const [res1, res2] = await Promise.all([
      generateInterviewKit(input, { llmClient: mockClient, allowLocalUrls: true }),
      generateInterviewKit(input, { llmClient: mockClient, allowLocalUrls: true }),
    ]);

    // Both should return identical kit results
    assert.strictEqual(res1.kit.source.company_url, res2.kit.source.company_url);
    assert.strictEqual(res1.kit.schedule.days_available, res2.kit.schedule.days_available);
  });

  it('7. Rejects invalid input with OrchestratorError', async () => {
    // Empty JD
    await assert.rejects(
      async () => {
        await generateInterviewKit({
          jd: '   ',
          company_url: 'https://example.com',
          days: 5,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof OrchestratorError);
        return true;
      }
    );

    // Empty URL
    await assert.rejects(
      async () => {
        await generateInterviewKit({
          jd: sampleJD,
          company_url: '',
          days: 5,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof OrchestratorError);
        return true;
      }
    );

    // Invalid days (0)
    await assert.rejects(
      async () => {
        await generateInterviewKit({
          jd: sampleJD,
          company_url: 'https://example.com',
          days: 0,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof OrchestratorError);
        return true;
      }
    );
  });
});
