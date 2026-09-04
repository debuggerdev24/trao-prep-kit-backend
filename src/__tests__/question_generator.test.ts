import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateQuestions,
  QuestionGenerationError,
} from '../services/questions/index.js';
import { MockLanguageModelClient } from '../services/llm/mock.js';
import type { Role } from '../domain/kit.types.js';

function getSampleRole(): Role {
  return {
    title: 'Senior Full-Stack Engineer',
    seniority: 'Senior',
    responsibilities: ['Build APIs', 'Scale database queries', 'Mentor junior engineers'],
    requirements: [
      { id: 'r1', text: 'Proficiency with TypeScript and React', kind: 'technical', priority: 'must' },
      { id: 'r2', text: 'Experience with PostgreSQL and distributed message queues', kind: 'technical', priority: 'must' },
      { id: 'r3', text: 'Experience mentoring mid-level developers and leading design reviews', kind: 'behavioural', priority: 'must' },
      { id: 'r4', text: 'Familiarity with PCI-DSS compliance in FinTech', kind: 'domain', priority: 'nice' },
    ],
  };
}

describe('Interview Question Generation (Phase 6)', () => {
  describe('Deliberate Category Generation & Requirement Mapping', () => {
    it('generates questions across all categories mapped strictly to valid requirement IDs', async () => {
      const sampleRole = getSampleRole();

      // Mock returns realistic structured questions for the categories
      const mockResponses = [
        // 1. Technical
        JSON.stringify({
          questions: [
            {
              requirement_ids: ['r1'],
              category: 'technical',
              prompt: 'Explain how React Concurrent Mode works with Fiber architecture under heavy load.',
              answer_outline: 'Time slicing, priority lane allocation, interrupted rendering.',
              difficulty: 2,
            },
          ],
        }),
        // 2. Behavioural
        JSON.stringify({
          questions: [
            {
              requirement_ids: ['r3'],
              category: 'behavioural',
              prompt: 'Describe a situation where you mediated an architectural disagreement between two senior engineers.',
              answer_outline: 'STAR framework: situation, conflict, resolution through metrics and trade-offs.',
              difficulty: 2,
            },
          ],
        }),
        // 3. System Design
        JSON.stringify({
          questions: [
            {
              requirement_ids: ['r2'],
              category: 'system-design',
              prompt: 'Design an idempotent payment event processing pipeline using PostgreSQL and Kafka.',
              answer_outline: 'Outbox pattern, consumer groups, deduplication tables, at-least-once delivery.',
              difficulty: 3,
            },
          ],
        }),
        // 4. Company Fit
        JSON.stringify({
          questions: [
            {
              requirement_ids: ['r4'],
              category: 'company-fit',
              prompt: 'How do you balance strict PCI-DSS audit compliance with rapid deployment cycles?',
              answer_outline: 'Infrastructure as Code, ephemeral test tokens, automated vulnerability scans.',
              difficulty: 2,
            },
          ],
        }),
      ];

      let callIndex = 0;
      const customClient = {
        async complete() {
          const resp = mockResponses[callIndex % mockResponses.length];
          callIndex++;
          return resp;
        },
      };

      const questions = await generateQuestions(
        {
          role: sampleRole,
          companyResearch: {
            companyName: 'Stripe',
            companyBrief: {
              summary: 'Stripe builds financial infrastructure.',
              what_they_do: 'Payments and banking APIs.',
              sources: ['https://stripe.com'],
            },
          },
          interviewResearch: {
            foundUsefulInfo: true,
            roundsSummary: ['Technical Coding', 'System Design Round'],
            focusAreas: ['Distributed systems', 'Idempotency'],
            confidence: 'high',
          },
        },
        { llmClient: customClient }
      );

      assert.strictEqual(questions.length, 4);

      // Verify stable IDs: q1, q2, q3, q4
      assert.strictEqual(questions[0].id, 'q1');
      assert.strictEqual(questions[1].id, 'q2');
      assert.strictEqual(questions[2].id, 'q3');
      assert.strictEqual(questions[3].id, 'q4');

      // Verify all categories represented
      const categories = questions.map((q) => q.category);
      assert.ok(categories.includes('technical'));
      assert.ok(categories.includes('behavioural'));
      assert.ok(categories.includes('system-design'));
      assert.ok(categories.includes('company-fit'));

      // Verify referential integrity: ALL requirement_ids are from the sample role
      const validIds = new Set(sampleRole.requirements.map((r) => r.id));
      for (const q of questions) {
        assert.ok(q.requirement_ids.length >= 1);
        for (const reqId of q.requirement_ids) {
          assert.ok(validIds.has(reqId), `Question references invalid requirement ID: ${reqId}`);
        }
      }

      // Verify difficulty is integer 1 to 3
      for (const q of questions) {
        assert.ok([1, 2, 3].includes(q.difficulty));
      }
    });
  });

  describe('Anti-Hallucination: Rejection of Invented Requirement IDs', () => {
    it('prunes or rejects questions referencing hallucinated requirement IDs not in the job posting', async () => {
      const sampleRole = getSampleRole(); // Has r1, r2, r3, r4

      // Mock LLM tries to invent requirement IDs like "r99" and "tech_unknown"
      const maliciousResponse = JSON.stringify({
        questions: [
          {
            requirement_ids: ['r99'], // Hallucinated!
            category: 'technical',
            prompt: 'Question referencing hallucinated r99.',
            answer_outline: 'None',
            difficulty: 1,
          },
          {
            requirement_ids: ['r1', 'fake_id'], // Contains valid r1 and fake_id
            category: 'technical',
            prompt: 'Explain TypeScript generics and conditional types.',
            answer_outline: 'Generic constraints, infer keyword.',
            difficulty: 2,
          },
        ],
      });

      const mockClient = new MockLanguageModelClient(maliciousResponse);

      const questions = await generateQuestions(
        { role: sampleRole },
        { llmClient: mockClient }
      );

      // Question 1 (referencing only r99) MUST be dropped!
      // Question 2 (referencing r1 and fake_id) MUST have fake_id stripped, keeping only r1!
      assert.strictEqual(questions.length, 1);
      assert.deepStrictEqual(questions[0].requirement_ids, ['r1']);
      assert.strictEqual(questions[0].prompt, 'Explain TypeScript generics and conditional types.');
    });
  });

  describe('Malformed Response Handling & Sanitization', () => {
    it('sanitizes responses wrapped in markdown code fences and repairs trailing commas', async () => {
      const sampleRole = getSampleRole();

      const rawMarkdown = `
      \`\`\`json
      {
        "questions": [
          {
            "requirement_ids": ["r1"],
            "category": "technical",
            "prompt": "How does event loop scheduling interact with microtasks?",
            "answer_outline": "Microtask queue processed after each task.",
            "difficulty": 2,
          },
        ],
      }
      \`\`\`
      `;

      const mockClient = new MockLanguageModelClient(rawMarkdown);

      const questions = await generateQuestions(
        { role: sampleRole },
        { llmClient: mockClient }
      );

      assert.strictEqual(questions.length, 1);
      assert.strictEqual(questions[0].id, 'q1');
      assert.strictEqual(questions[0].category, 'technical');
      assert.deepStrictEqual(questions[0].requirement_ids, ['r1']);
    });

    it('throws QuestionGenerationError if role requirements are empty', async () => {
      const emptyRole: Role = {
        title: 'Empty',
        seniority: 'Mid',
        responsibilities: [],
        requirements: [],
      };

      await assert.rejects(
        () => generateQuestions({ role: emptyRole }),
        (err) => err instanceof QuestionGenerationError
      );
    });
  });
});
