import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  evaluateCase,
  runBatchEvaluation,
  parseArgs,
  loadCases,
  type BatchEvaluationOutput,
} from '../batch.js';
import { MockLanguageModelClient } from '../services/llm/mock.js';

const TEMP_DIR = path.join(__dirname, '..', '..', 'temp-test-batch');

function writeTempFile(filename: string, content: string): string {
  const filePath = path.join(TEMP_DIR, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function createSmartMockLLMClient() {
  return new MockLanguageModelClient((messages) => {
    const lastMsg = messages[messages.length - 1]?.content || '';

    // Requirement extraction stage
    if (lastMsg.includes('Extract') || lastMsg.includes('role') || lastMsg.includes('Job Description')) {
      return JSON.stringify({
        title: 'Full-Stack Software Engineer',
        seniority: 'Senior',
        responsibilities: [
          'Architect resilient backend services and APIs',
          'Build responsive web interfaces using React',
        ],
        requirements: [
          { id: 'r1', text: 'Proficiency in TypeScript and React', kind: 'technical', priority: 'must' },
          { id: 'r2', text: 'Experience mentoring and team leadership', kind: 'behavioural', priority: 'must' },
        ],
      });
    }

    // Question generation stage
    if (lastMsg.includes('question') || lastMsg.includes('Question')) {
      return JSON.stringify({
        questions: [
          {
            requirement_ids: ['r1'],
            category: 'technical',
            prompt: 'Explain React rendering lifecycle and virtual DOM reconciliation.',
            answer_outline: 'Fiber tree, work-in-progress, commit phase',
            difficulty: 2,
          },
          {
            requirement_ids: ['r2'],
            category: 'behavioural',
            prompt: 'Describe a time you navigated a challenging technical disagreement.',
            answer_outline: 'Data-driven discussion, consensus building, focus on customer value',
            difficulty: 1,
          },
        ],
      });
    }

    // Flashcards stage
    if (lastMsg.includes('flashcard') || lastMsg.includes('Flashcard')) {
      return JSON.stringify({
        flashcards: [
          {
            front: 'What is the primary benefit of React Fiber?',
            back: 'Allows incremental rendering and pausing work to prioritize high-priority user updates.',
            requirement_ids: ['r1'],
          },
        ],
      });
    }

    // Company brief or other fallback
    return JSON.stringify({
      summary: 'Acme builds enterprise developer platforms.',
      what_they_do: 'Cloud developer tools and SDKs.',
    });
  });
}

describe('Mandatory Batch Evaluation Command (Phase 13)', () => {
  before(() => {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  });

  after(() => {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  describe('CLI Argument Parsing & Input Validation', () => {
    it('parses --input and --output with space separation', () => {
      const args = parseArgs(['node', 'batch.js', '--input', 'cases.json', '--output', 'kits.json']);
      assert.ok(args.input.endsWith('cases.json'));
      assert.ok(args.output.endsWith('kits.json'));
    });

    it('parses --input=... and --output=... with equals format', () => {
      const args = parseArgs(['node', 'batch.js', '--input=cases.json', '--output=kits.json']);
      assert.ok(args.input.endsWith('cases.json'));
      assert.ok(args.output.endsWith('kits.json'));
    });

    it('loads and validates JSON array from file', () => {
      const filePath = writeTempFile('test-cases-array.json', JSON.stringify([{ id: 'c1' }]));
      const cases = loadCases(filePath);
      assert.strictEqual(Array.isArray(cases), true);
      assert.strictEqual(cases.length, 1);
    });
  });

  describe('Core Evaluation Scenarios', () => {
    it('evaluates one successful case with status "ok" and valid Appendix A kit', async () => {
      const rawCase = {
        id: 'case-01-success',
        jd: 'Full Stack Engineer with TypeScript and React experience. Must lead projects and mentor.',
        company_url: 'https://example.com/acme',
        days: 5,
      };

      const mockClient = createSmartMockLLMClient();
      const output = await evaluateCase(rawCase, 0, { llmClient: mockClient });

      assert.strictEqual(output.id, 'case-01-success');
      assert.strictEqual(output.status, 'ok');
      assert.strictEqual(output.error, null);
      assert.ok(output.kit, 'Kit must be present on ok status');
      assert.strictEqual((output.kit as any).schedule.days_available, 5);
      assert.strictEqual((output.kit as any).schedule.days.length, 5);
      assert.ok((output.kit as any).questions.length > 0);
    });

    it('handles multiple cases sequentially in a batch file', async () => {
      const cases = [
        {
          id: 'case-multi-1',
          jd: 'React developer for scalable dashboard interfaces.',
          company_url: 'https://example.com/multi1',
          days: 3,
        },
        {
          id: 'case-multi-2',
          jd: 'Node backend specialist building distributed APIs.',
          company_url: 'https://example.com/multi2',
          days: 7,
        },
      ];

      const inputPath = writeTempFile('multiple-cases.json', JSON.stringify(cases));
      const outputPath = path.join(TEMP_DIR, 'multiple-kits-output.json');

      const mockClient = createSmartMockLLMClient();
      const batchResult = await runBatchEvaluation(inputPath, outputPath, { llmClient: mockClient });

      assert.strictEqual(batchResult.version, '1.0');
      assert.ok(batchResult.generated_at);
      assert.strictEqual(batchResult.kits.length, 2);
      assert.strictEqual(batchResult.kits[0].id, 'case-multi-1');
      assert.strictEqual(batchResult.kits[0].status, 'ok');
      assert.strictEqual(batchResult.kits[1].id, 'case-multi-2');
      assert.strictEqual(batchResult.kits[1].status, 'ok');

      // Verify file written to disk
      assert.strictEqual(fs.existsSync(outputPath), true);
      const parsedDisk = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      assert.strictEqual(parsedDisk.kits.length, 2);
    });

    it('handles partial research (company with no hiring page) honestly as "ok"', async () => {
      const rawCase = {
        id: 'case-partial-research',
        jd: 'Lead Engineer building data pipelines.',
        company_url: 'https://example.com/no-careers-page',
        days: 4,
      };

      const mockClient = createSmartMockLLMClient();
      const output = await evaluateCase(rawCase, 0, { llmClient: mockClient });

      // Partial research must still be status "ok" if a valid kit can be produced
      assert.strictEqual(output.status, 'ok');
      assert.strictEqual(output.error, null);
      assert.ok(output.kit);
      assert.strictEqual((output.kit as any).schedule.days_available, 4);
    });

    it('handles invalid company URL gracefully as "ok" with honest fallback', async () => {
      const rawCase = {
        id: 'case-invalid-url',
        jd: 'Systems Programmer working on operating system internals and kernel modules.',
        company_url: 'not-a-valid-http-url',
        days: 2,
      };

      const mockClient = createSmartMockLLMClient();
      const output = await evaluateCase(rawCase, 0, { llmClient: mockClient });

      // Invalid company URL falls back honestly and produces valid kit
      assert.strictEqual(output.status, 'ok');
      assert.strictEqual(output.error, null);
      assert.ok(output.kit);
      assert.strictEqual((output.kit as any).schedule.days_available, 2);
    });

    it('handles thin JD as "ok"', async () => {
      const rawCase = {
        id: 'case-thin-jd',
        jd: 'Short JD: Frontend developer needed.',
        company_url: 'https://example.com/thin',
        days: 1,
      };

      const mockClient = createSmartMockLLMClient();
      const output = await evaluateCase(rawCase, 0, { llmClient: mockClient });

      assert.strictEqual(output.status, 'ok');
      assert.strictEqual(output.error, null);
      assert.ok(output.kit);
      assert.strictEqual((output.kit as any).schedule.days_available, 1);
    });

    it('verifies exact days are reflected in schedule', async () => {
      const testDays = [1, 2, 7, 14, 30];
      const mockClient = createSmartMockLLMClient();

      for (const d of testDays) {
        const output = await evaluateCase(
          {
            id: `case-days-${d}`,
            jd: 'Full-stack software developer with React and Node.js.',
            company_url: 'https://example.com',
            days: d,
          },
          0,
          { llmClient: mockClient }
        );

        assert.strictEqual(output.status, 'ok');
        assert.strictEqual((output.kit as any).schedule.days_available, d);
        assert.strictEqual((output.kit as any).schedule.days.length, d);
      }
    });

    it('records failure without aborting the batch when a case has invalid input', async () => {
      const cases = [
        {
          id: 'case-valid-before',
          jd: 'Valid Engineer JD',
          company_url: 'https://example.com/ok1',
          days: 3,
        },
        {
          id: 'case-invalid-empty-jd',
          jd: '', // Missing JD
          company_url: 'https://example.com/bad',
          days: 5,
        },
        {
          id: 'case-invalid-negative-days',
          jd: 'Another valid JD',
          company_url: 'https://example.com/bad-days',
          days: -1, // Invalid days
        },
        {
          id: 'case-valid-after',
          jd: 'Valid Engineer JD 2',
          company_url: 'https://example.com/ok2',
          days: 2,
        },
      ];

      const inputPath = writeTempFile('mixed-cases.json', JSON.stringify(cases));
      const outputPath = path.join(TEMP_DIR, 'mixed-output.json');

      const mockClient = createSmartMockLLMClient();
      const batchResult = await runBatchEvaluation(inputPath, outputPath, { llmClient: mockClient });

      // All 4 cases must be processed without process abortion
      assert.strictEqual(batchResult.kits.length, 4);

      // Case 1: ok
      assert.strictEqual(batchResult.kits[0].id, 'case-valid-before');
      assert.strictEqual(batchResult.kits[0].status, 'ok');
      assert.strictEqual(batchResult.kits[0].error, null);

      // Case 2: failed
      assert.strictEqual(batchResult.kits[1].id, 'case-invalid-empty-jd');
      assert.strictEqual(batchResult.kits[1].status, 'failed');
      assert.strictEqual(batchResult.kits[1].kit, null);
      assert.ok(batchResult.kits[1].error?.code);
      assert.ok(batchResult.kits[1].error?.message);

      // Case 3: failed
      assert.strictEqual(batchResult.kits[2].id, 'case-invalid-negative-days');
      assert.strictEqual(batchResult.kits[2].status, 'failed');
      assert.strictEqual(batchResult.kits[2].kit, null);

      // Case 4: ok (execution continued after failures!)
      assert.strictEqual(batchResult.kits[3].id, 'case-valid-after');
      assert.strictEqual(batchResult.kits[3].status, 'ok');
      assert.strictEqual(batchResult.kits[3].error, null);
      assert.ok(batchResult.kits[3].kit);
    });

    it('conforms strictly to the required output schema', async () => {
      const inputPath = path.join(__dirname, 'fixtures', 'evaluation_cases.json');
      const outputPath = path.join(TEMP_DIR, 'fixture-eval-output.json');

      const mockClient = createSmartMockLLMClient();
      const batchResult = await runBatchEvaluation(inputPath, outputPath, { llmClient: mockClient });

      // Schema assertions
      assert.strictEqual(batchResult.version, '1.0');
      assert.ok(batchResult.generated_at);
      assert.ok(!isNaN(Date.parse(batchResult.generated_at)));
      assert.strictEqual(Array.isArray(batchResult.kits), true);
      assert.strictEqual(batchResult.kits.length, 5);

      for (const k of batchResult.kits) {
        assert.ok(typeof k.id === 'string' && k.id.length > 0);
        assert.ok(k.status === 'ok' || k.status === 'failed');
        if (k.status === 'ok') {
          assert.ok(k.kit && typeof k.kit === 'object');
          assert.strictEqual(k.error, null);
        } else {
          assert.strictEqual(k.kit, null);
          assert.ok(k.error && typeof k.error === 'object');
          assert.ok(typeof k.error.code === 'string');
          assert.ok(typeof k.error.message === 'string');
        }
      }
    });
  });
});
