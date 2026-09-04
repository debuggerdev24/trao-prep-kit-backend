import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateQuestions,
  QuestionGenerationError,
} from '../services/generation/generation.service.js';
import { MockLanguageModelClient } from '../services/llm/mock.js';
import type { Requirement } from '../domain/kit.types.js';
import type { CompanyResearchResult } from '../services/crawler/crawler.types.js';

const SAMPLE_REQUIREMENTS: Requirement[] = [
  { id: 'r1', text: '5+ years of React experience', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Strong mentoring and leadership skills', kind: 'behavioural', priority: 'must' },
  { id: 'r3', text: 'Experience with distributed systems architecture', kind: 'technical', priority: 'must' },
  { id: 'r4', text: 'Healthcare domain knowledge', kind: 'domain', priority: 'nice' },
];

const SAMPLE_INPUT = {
  requirements: SAMPLE_REQUIREMENTS,
  roleTitle: 'Senior Frontend Engineer',
  roleSeniority: 'Senior',
  responsibilities: [
    'Lead frontend architecture decisions',
    'Mentor junior engineers',
    'Design scalable component systems',
  ],
};

function makeQuestionsResponse(questions: Array<{
  requirement_ids: string[];
  category: string;
  prompt: string;
  answer_outline: string | string[];
  difficulty: number;
}>) {
  return JSON.stringify({ questions });
}

describe('Question Generation Service (Phase 6)', () => {
  describe('Technical Questions', () => {
    it('generates technical questions for technical requirements', async () => {
      const mockResponse = makeQuestionsResponse([
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'Describe your experience building complex React applications with hooks and context.',
          answer_outline: ['Mention custom hooks', 'Discuss state management patterns', 'Performance optimization'],
          difficulty: 2,
        },
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'How would you optimize a React component that re-renders excessively?',
          answer_outline: ['Use React.memo', 'Memoize callbacks', 'Profile with React DevTools'],
          difficulty: 3,
        },
      ]);

      const mockClient = new MockLanguageModelClient(mockResponse);
      const questions = await generateQuestions(SAMPLE_INPUT, { llmClient: mockClient });

      assert.ok(questions.length >= 2);
      assert.ok(questions.every((q) => q.category === 'technical'));
      assert.ok(questions.every((q) => q.requirement_ids.includes('r1')));
      assert.ok(questions.every((q) => q.id.startsWith('q')));
    });
  });

  describe('Behavioural Questions', () => {
    it('generates behavioural questions for behavioural requirements', async () => {
      const mockResponse = makeQuestionsResponse([
        {
          requirement_ids: ['r2'],
          category: 'behavioural',
          prompt: 'Tell me about a time you mentored a struggling junior engineer. What was the outcome?',
          answer_outline: ['Describe the situation', 'Explain mentoring approach', 'Quantify improvement'],
          difficulty: 2,
        },
      ]);

      const mockClient = new MockLanguageModelClient(mockResponse);
      const questions = await generateQuestions(SAMPLE_INPUT, { llmClient: mockClient });

      const behavioural = questions.filter((q) => q.category === 'behavioural');
      assert.ok(behavioural.length >= 1);
      assert.ok(behavioural.every((q) => q.requirement_ids.includes('r2')));
    });
  });

  describe('System Design Questions', () => {
    it('generates system-design questions for technical distributed-systems requirements', async () => {
      const mockResponse = makeQuestionsResponse([
        {
          requirement_ids: ['r3'],
          category: 'system-design',
          prompt: 'Design a real-time notification system that handles 10M+ users. Walk through your architecture.',
          answer_outline: ['Message queue', 'WebSocket connections', 'Horizontal scaling', 'Failover strategy'],
          difficulty: 3,
        },
      ]);

      const mockClient = new MockLanguageModelClient(mockResponse);
      const questions = await generateQuestions(SAMPLE_INPUT, { llmClient: mockClient });

      const systemDesign = questions.filter((q) => q.category === 'system-design');
      assert.ok(systemDesign.length >= 1);
      assert.ok(systemDesign[0].difficulty === 3);
      assert.ok(systemDesign[0].requirement_ids.includes('r3'));
    });
  });

  describe('Company Fit Questions', () => {
    it('generates company-fit questions when company research is provided', async () => {
      const companyResearch: CompanyResearchResult = {
        companyUrl: 'https://healthtech.com',
        companyName: 'HealthTech Inc',
        companyText: 'We build healthcare analytics platforms.',
        hiringText: 'Our interview process has 3 rounds: phone screen, system design, and behavioral.',
        sources: ['https://healthtech.com/careers'],
        pagesUsed: ['https://healthtech.com', 'https://healthtech.com/careers'],
        hasHiringInfo: true,
        companyBrief: {
          summary: 'HealthTech builds healthcare analytics.',
          what_they_do: 'Healthcare data platform for hospitals.',
          sources: ['https://healthtech.com'],
        },
      };

      const mockResponse = makeQuestionsResponse([
        {
          requirement_ids: ['r4'],
          category: 'company-fit',
          prompt: 'What interests you about working in healthcare technology specifically?',
          answer_outline: ['Impact on patient outcomes', 'Data-driven healthcare', 'Regulatory challenges'],
          difficulty: 1,
        },
      ]);

      const mockClient = new MockLanguageModelClient(mockResponse);
      const inputWithCompany = { ...SAMPLE_INPUT, companyResearch };
      const questions = await generateQuestions(inputWithCompany, { llmClient: mockClient });

      const companyFit = questions.filter((q) => q.category === 'company-fit');
      assert.ok(companyFit.length >= 1);
    });
  });

  describe('Requirement Mapping', () => {
    it('every generated question references at least one valid requirement ID', async () => {
      const mockResponse = makeQuestionsResponse([
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'React performance optimization strategies?',
          answer_outline: ['Memoization', 'Code splitting'],
          difficulty: 2,
        },
        {
          requirement_ids: ['r2'],
          category: 'behavioural',
          prompt: 'Describe your mentoring approach.',
          answer_outline: ['Regular 1:1s', 'Code reviews'],
          difficulty: 1,
        },
      ]);

      const mockClient = new MockLanguageModelClient(mockResponse);
      const questions = await generateQuestions(SAMPLE_INPUT, { llmClient: mockClient });

      const validIds = new Set(SAMPLE_REQUIREMENTS.map((r) => r.id));
      for (const q of questions) {
        assert.ok(q.requirement_ids.length > 0, `Question ${q.id} has no requirement_ids`);
        for (const reqId of q.requirement_ids) {
          assert.ok(validIds.has(reqId), `Question ${q.id} references invalid requirement ID: ${reqId}`);
        }
      }
    });
  });

  describe('Invalid Requirement IDs', () => {
    it('filters out questions that only reference non-existent requirement IDs', async () => {
      const mockResponse = makeQuestionsResponse([
        {
          requirement_ids: ['FAKE_ID'],
          category: 'technical',
          prompt: 'This references a fake requirement.',
          answer_outline: ['Answer'],
          difficulty: 1,
        },
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'This references a real requirement.',
          answer_outline: ['Answer'],
          difficulty: 2,
        },
      ]);

      const mockClient = new MockLanguageModelClient(mockResponse);
      const questions = await generateQuestions(SAMPLE_INPUT, { llmClient: mockClient });

      // The FAKE_ID question should have been discarded
      assert.ok(questions.every((q) => q.requirement_ids.every((id) => id !== 'FAKE_ID')));
      // The valid question should remain
      assert.ok(questions.some((q) => q.requirement_ids.includes('r1')));
    });

    it('preserves mixed valid/invalid requirement_ids by keeping only valid ones', async () => {
      const mockResponse = makeQuestionsResponse([
        {
          requirement_ids: ['r1', 'NONEXISTENT'],
          category: 'technical',
          prompt: 'Mixed requirement references.',
          answer_outline: ['Answer'],
          difficulty: 2,
        },
      ]);

      const mockClient = new MockLanguageModelClient(mockResponse);
      const questions = await generateQuestions(SAMPLE_INPUT, { llmClient: mockClient });

      assert.strictEqual(questions.length, 1);
      assert.deepStrictEqual(questions[0].requirement_ids, ['r1']);
    });

    it('throws when all generated questions reference invalid IDs', async () => {
      const mockResponse = makeQuestionsResponse([
        {
          requirement_ids: ['fake1', 'fake2'],
          category: 'technical',
          prompt: 'All IDs are invalid.',
          answer_outline: ['Answer'],
          difficulty: 1,
        },
      ]);

      const mockClient = new MockLanguageModelClient(mockResponse);
      await assert.rejects(
        () => generateQuestions(SAMPLE_INPUT, { llmClient: mockClient }),
        (err) =>
          err instanceof QuestionGenerationError &&
          err.message.includes('No valid questions were generated')
      );
    });
  });

  describe('Malformed Model Response', () => {
    it('retries and eventually fails on unparseable JSON', async () => {
      const mockClient = new MockLanguageModelClient('This is not JSON at all');
      await assert.rejects(
        () => generateQuestions(SAMPLE_INPUT, { llmClient: mockClient }),
        (err) =>
          err instanceof QuestionGenerationError
      );
    });

    it('throws on valid JSON that fails schema validation', async () => {
      const invalidSchema = JSON.stringify({ questions: [{ prompt: 'missing fields' }] });
      const mockClient = new MockLanguageModelClient(invalidSchema);
      await assert.rejects(
        () => generateQuestions(SAMPLE_INPUT, { llmClient: mockClient }),
        (err) =>
          err instanceof QuestionGenerationError &&
          err.message.includes('failed validation')
      );
    });

    it('sanitizes markdown-wrapped JSON responses', async () => {
      const wrappedResponse = `\`\`\`json
${makeQuestionsResponse([
  {
    requirement_ids: ['r1'],
    category: 'technical',
    prompt: 'Sanitized response test.',
    answer_outline: ['Point 1'],
    difficulty: 1,
  },
])}
\`\`\``;

      const mockClient = new MockLanguageModelClient(wrappedResponse);
      const questions = await generateQuestions(SAMPLE_INPUT, { llmClient: mockClient });
      assert.strictEqual(questions.length, 1);
      assert.strictEqual(questions[0].prompt, 'Sanitized response test.');
    });

    it('handles trailing commas in JSON', async () => {
      const trailingComma = `{
        "questions": [
          {
            "requirement_ids": ["r1"],
            "category": "technical",
            "prompt": "Trailing comma test.",
            "answer_outline": ["Point 1",],
            "difficulty": 2,
          },
        ]
      }`;

      const mockClient = new MockLanguageModelClient(trailingComma);
      const questions = await generateQuestions(SAMPLE_INPUT, { llmClient: mockClient });
      assert.strictEqual(questions.length, 1);
    });
  });

  describe('Deduplication', () => {
    it('removes duplicate questions with identical prompt text', async () => {
      const mockResponse = makeQuestionsResponse([
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'Tell me about your React experience.',
          answer_outline: ['Answer'],
          difficulty: 2,
        },
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'Tell me about your React experience.', // Exact duplicate
          answer_outline: ['Different answer'],
          difficulty: 3,
        },
      ]);

      const mockClient = new MockLanguageModelClient(mockResponse);
      const questions = await generateQuestions(SAMPLE_INPUT, { llmClient: mockClient });

      // Deduplication should keep only one
      const reactQuestions = questions.filter((q) => q.prompt === 'Tell me about your React experience.');
      assert.strictEqual(reactQuestions.length, 1);
    });
  });

  describe('Empty Requirements', () => {
    it('throws when no requirements are provided', async () => {
      const mockClient = new MockLanguageModelClient('{}');
      await assert.rejects(
        () =>
          generateQuestions(
            { ...SAMPLE_INPUT, requirements: [] },
            { llmClient: mockClient }
          ),
        (err) =>
          err instanceof QuestionGenerationError &&
          err.message.includes('Cannot generate questions without requirements')
      );
    });
  });

  describe('Stable IDs', () => {
    it('assigns sequential stable IDs q1, q2, q3...', async () => {
      const mockResponse = makeQuestionsResponse([
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'First question.',
          answer_outline: ['A'],
          difficulty: 1,
        },
        {
          requirement_ids: ['r2'],
          category: 'behavioural',
          prompt: 'Second question.',
          answer_outline: ['B'],
          difficulty: 2,
        },
        {
          requirement_ids: ['r3'],
          category: 'system-design',
          prompt: 'Third question.',
          answer_outline: ['C'],
          difficulty: 3,
        },
      ]);

      const mockClient = new MockLanguageModelClient(mockResponse);
      const questions = await generateQuestions(SAMPLE_INPUT, { llmClient: mockClient });

      assert.strictEqual(questions[0].id, 'q1');
      assert.strictEqual(questions[1].id, 'q2');
      assert.strictEqual(questions[2].id, 'q3');
    });
  });

  describe('Rate Limiting & Retries', () => {
    it('recovers from transient 429 errors', async () => {
      const validResponse = makeQuestionsResponse([
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'Recovered question.',
          answer_outline: ['Answer'],
          difficulty: 2,
        },
      ]);

      // Simulate 1 rate limit failure; service will retry that specific LLM call
      const mockClient = new MockLanguageModelClient(validResponse, 1);
      const questions = await generateQuestions(SAMPLE_INPUT, { llmClient: mockClient, maxRetries: 2 });

      assert.ok(questions.length >= 1);
      // The mock received at least 1 retry (callCount > 1 means a retry happened)
      assert.ok(mockClient.callCount > 1, `Expected retries but callCount was ${mockClient.callCount}`);
    });
  });

  describe('Difficulty Range', () => {
    it('produces questions with valid difficulty values (1, 2, or 3)', async () => {
      const mockResponse = makeQuestionsResponse([
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'Easy question.',
          answer_outline: ['Basic answer'],
          difficulty: 1,
        },
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'Medium question.',
          answer_outline: ['Intermediate answer'],
          difficulty: 2,
        },
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'Hard question.',
          answer_outline: ['Advanced answer'],
          difficulty: 3,
        },
      ]);

      const mockClient = new MockLanguageModelClient(mockResponse);
      const questions = await generateQuestions(SAMPLE_INPUT, { llmClient: mockClient });

      assert.ok(questions.every((q) => [1, 2, 3].includes(q.difficulty)));
    });
  });
});
