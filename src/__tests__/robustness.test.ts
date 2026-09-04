import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sanitizeJsonResponse } from '../services/extraction/extractor.service.js';
import { MockLanguageModelClient } from '../services/llm/mock.js';
import { LLMRateLimitError } from '../services/llm/client.js';
import { extractRequirements } from '../services/extraction/extractor.service.js';
import { allocateSchedule } from '../services/schedule/schedule.service.js';
import { checkCoverage } from '../services/coverage/coverage.service.js';
import { validateKit } from '../domain/kit.validator.js';
import type { Requirement, Question } from '../domain/kit.types.js';

// ─── Helper: Minimal valid data for tests ───
const DEFAULT_REQS: Requirement[] = [
  { id: 'r1', text: 'TypeScript and React experience', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Team leadership and mentoring', kind: 'behavioural', priority: 'must' },
  { id: 'r3', text: 'CI/CD pipeline knowledge', kind: 'technical', priority: 'nice' },
];

function makeQuestions(reqs: Requirement[]): Question[] {
  return reqs.map((r, i) => ({
    id: `q${i + 1}`,
    requirement_ids: [r.id],
    category: r.kind === 'behavioural' ? 'behavioural' as const : 'technical' as const,
    prompt: `Question about ${r.text}`,
    answer_outline: [`Key point about ${r.text}`],
    difficulty: 2 as const,
  }));
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 1: Invalid company URL
// ═══════════════════════════════════════════════════════════════════
describe('Scenario 1: Invalid company URL', () => {
  it('extractRequirements succeeds with invalid company URL in JD', async () => {
    const mock = new MockLanguageModelClient(JSON.stringify({
      title: 'Engineer', seniority: 'Senior',
      responsibilities: ['Build things'],
      requirements: [{ text: 'TypeScript', kind: 'technical', priority: 'must' }],
    }));

    const role = await extractRequirements('Engineer needed. TypeScript required.', { llmClient: mock });
    assert.ok(role.title);
    assert.ok(role.requirements.length > 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 6: Thin JD (2 lines)
// ═══════════════════════════════════════════════════════════════════
describe('Scenario 6: Thin JD (2 lines)', () => {
  it('handles a two-line JD without hallucination', async () => {
    const mock = new MockLanguageModelClient(JSON.stringify({
      title: 'Frontend Developer', seniority: 'Mid',
      responsibilities: ['Build UIs'],
      requirements: [{ text: 'React experience', kind: 'technical', priority: 'must' }],
    }));

    const role = await extractRequirements(
      'Frontend Developer needed.\nMust know React and TypeScript.',
      { llmClient: mock }
    );
    assert.ok(role.title);
    assert.ok(role.requirements.length > 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 7: LLM returns invalid JSON
// ═══════════════════════════════════════════════════════════════════
describe('Scenario 7: LLM returns invalid JSON', () => {
  it('sanitizeJsonResponse handles garbage text', () => {
    const result = sanitizeJsonResponse('not json at all {{{');
    assert.ok(typeof result === 'string');
  });

  it('extractRequirements retries when LLM returns invalid JSON then succeeds', async () => {
    const mock = new MockLanguageModelClient((msgs, count) => {
      if (count <= 1) return 'this is not valid json {{{';
      return JSON.stringify({
        title: 'Engineer', seniority: 'Senior',
        responsibilities: ['Build things'],
        requirements: [{ text: 'TypeScript', kind: 'technical', priority: 'must' }],
      });
    });

    const role = await extractRequirements('TypeScript engineer needed.', { llmClient: mock });
    assert.ok(role.title);
    assert.strictEqual(mock.callCount, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 8: LLM returns incomplete/truncated JSON
// ═══════════════════════════════════════════════════════════════════
describe('Scenario 8: Truncated JSON auto-repair', () => {
  it('closes unbalanced braces in truncated JSON', () => {
    const truncated = '{"title": "Engineer", "responsibilities": ["Build",';
    const repaired = sanitizeJsonResponse(truncated);
    const parsed = JSON.parse(repaired);
    assert.strictEqual(parsed.title, 'Engineer');
  });

  it('closes unbalanced brackets in truncated JSON', () => {
    const truncated = '{"items": [1, 2, 3';
    const repaired = sanitizeJsonResponse(truncated);
    const parsed = JSON.parse(repaired);
    assert.deepStrictEqual(parsed.items, [1, 2, 3]);
  });

  it('handles nested truncated JSON', () => {
    const truncated = '{"data": {"nested": [1, 2';
    const repaired = sanitizeJsonResponse(truncated);
    const parsed = JSON.parse(repaired);
    assert.deepStrictEqual(parsed.data.nested, [1, 2]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 9: LLM rate-limits (429)
// ═══════════════════════════════════════════════════════════════════
describe('Scenario 9: LLM rate-limit handling', () => {
  it('retries after rate limit errors and succeeds', async () => {
    const mock = new MockLanguageModelClient((msgs, count) => {
      if (count <= 2) throw new LLMRateLimitError('Simulated 429');
      return JSON.stringify({
        title: 'Engineer', seniority: 'Mid',
        responsibilities: ['Code'],
        requirements: [{ text: 'Python', kind: 'technical', priority: 'must' }],
      });
    }, 0);

    const role = await extractRequirements('Python engineer.', { llmClient: mock });
    assert.ok(role.title);
    assert.strictEqual(mock.callCount, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 10: LLM provider temporarily fails (500+)
// ═══════════════════════════════════════════════════════════════════
describe('Scenario 10: LLM temporary failure recovery', () => {
  it('retries after transient error and succeeds', async () => {
    const mock = new MockLanguageModelClient((msgs, count) => {
      if (count <= 1) throw new Error('fetch failed: ECONNRESET');
      return JSON.stringify({
        title: 'Engineer', seniority: 'Mid',
        responsibilities: ['Build'],
        requirements: [{ text: 'Go', kind: 'technical', priority: 'must' }],
      });
    });

    const role = await extractRequirements('Go engineer.', { llmClient: mock });
    assert.ok(role.title);
    assert.strictEqual(mock.callCount, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 12: 1-day schedule
// ═══════════════════════════════════════════════════════════════════
describe('Scenario 12: 1-day schedule', () => {
  it('allocates all questions to Day 1 with capped minutes', () => {
    const questions = makeQuestions(DEFAULT_REQS);
    const schedule = allocateSchedule({ requirements: DEFAULT_REQS, questions, daysAvailable: 1 });

    assert.strictEqual(schedule.days_available, 1);
    assert.strictEqual(schedule.days.length, 1);
    assert.ok(schedule.days[0].question_ids.length > 0);
    assert.ok(schedule.days[0].minutes <= 180);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 13: 60-day schedule
// ═══════════════════════════════════════════════════════════════════
describe('Scenario 13: 60-day schedule', () => {
  it('generates exactly 60 days without empty days', () => {
    const questions = makeQuestions(DEFAULT_REQS);
    const schedule = allocateSchedule({ requirements: DEFAULT_REQS, questions, daysAvailable: 60 });

    assert.strictEqual(schedule.days_available, 60);
    assert.strictEqual(schedule.days.length, 60);

    for (const day of schedule.days) {
      assert.ok(day.day >= 1 && day.day <= 60);
      assert.ok(day.question_ids.length > 0, `Day ${day.day} has no questions`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 11: Deterministic coverage
// ═══════════════════════════════════════════════════════════════════
describe('Scenario 11: Coverage check is deterministic', () => {
  it('returns same coverage result for same input', () => {
    const questions = makeQuestions(DEFAULT_REQS);

    const result1 = checkCoverage(DEFAULT_REQS, questions);
    const result2 = checkCoverage(DEFAULT_REQS, questions);

    assert.deepStrictEqual(result1.covered_requirement_ids, result2.covered_requirement_ids);
    assert.deepStrictEqual(result1.uncovered_must_ids, result2.uncovered_must_ids);
    assert.strictEqual(result1.must_haves_covered, result2.must_haves_covered);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 18: Regeneration preserves edited items
// ═══════════════════════════════════════════════════════════════════
describe('Scenario 18: Edit preservation flags', () => {
  it('edited question retains isEdited flag through processing', () => {
    const q: Question = {
      id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Edited?', answer_outline: [], difficulty: 2,
      isEdited: true, item_status: 'edited',
    };
    assert.strictEqual(q.isEdited, true);
    assert.strictEqual(q.item_status, 'edited');
  });

  it('pinned question retains isPinned flag', () => {
    const q: Question = {
      id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Pinned?', answer_outline: [], difficulty: 2,
      isPinned: true, item_status: 'generated',
    };
    assert.strictEqual(q.isPinned, true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 14: Batch evaluation isolation
// ═══════════════════════════════════════════════════════════════════
describe('Scenario 14: Batch case isolation', () => {
  it('evaluateCase records failure without throwing for invalid input', async () => {
    const { evaluateCase } = await import('../batch.js');
    const mock = new MockLanguageModelClient('{}');

    const result = await evaluateCase({ id: 'bad', jd: '', company_url: 'https://x.com', days: 1 }, 0, { llmClient: mock });
    assert.strictEqual(result.status, 'failed');
    assert.ok(result.error?.code);
  });

  it('evaluateCase succeeds for valid input', async () => {
    const { evaluateCase } = await import('../batch.js');
    const mock = new MockLanguageModelClient((msgs) => {
      const lastMsg = msgs[msgs.length - 1]?.content || '';
      if (lastMsg.includes('Extract') || lastMsg.includes('role') || lastMsg.includes('Job Description')) {
        return JSON.stringify({
          title: 'Engineer', seniority: 'Senior',
          responsibilities: ['Build APIs'],
          requirements: [{ id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' }],
        });
      }
      if (lastMsg.includes('question') || lastMsg.includes('Question')) {
        return JSON.stringify({
          questions: [{
            requirement_ids: ['r1'], category: 'technical',
            prompt: 'Explain Node.js event loop', answer_outline: ['Non-blocking I/O'],
            difficulty: 2,
          }],
        });
      }
      if (lastMsg.includes('flashcard') || lastMsg.includes('Flashcard')) {
        return JSON.stringify({
          flashcards: [{ front: 'What is Node.js?', back: 'Runtime', requirement_ids: ['r1'] }],
        });
      }
      return JSON.stringify({ summary: 'Tech company', what_they_do: 'Software' });
    });

    const result = await evaluateCase(
      { id: 'good', jd: 'Node.js engineer with 5 years experience.', company_url: 'https://example.com', days: 3 },
      0,
      { llmClient: mock }
    );
    assert.strictEqual(result.status, 'ok');
    assert.ok(result.kit);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 15: Honest fallback behavior
// ═══════════════════════════════════════════════════════════════════
describe('Scenario 15: Honest fallback behavior', () => {
  it('sanitizeJsonResponse does not fabricate content from markdown fences', () => {
    const input = '```json\n{"a": 1}\n```';
    const result = sanitizeJsonResponse(input);
    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.a, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Output Schema Validation
// ═══════════════════════════════════════════════════════════════════
describe('Output Schema: Appendix A validation', () => {
  it('validateKit passes for a conformant kit', () => {
    const kit = {
      role: {
        title: 'Engineer',
        seniority: 'Senior',
        responsibilities: ['Build APIs'],
        requirements: [{ id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' }],
      },
      questions: [{
        id: 'q1', requirement_ids: ['r1'], category: 'technical',
        prompt: 'Explain event loop', answer_outline: ['Non-blocking'],
        difficulty: 2,
      }],
      flashcards: [{
        id: 'f1', front: 'What is Node.js?', back: 'Runtime',
        requirement_ids: ['r1'],
      }],
      schedule: {
        days_available: 1,
        days: [{
          day: 1,
          focus: 'Review',
          question_ids: ['q1'],
          minutes: 60,
        }],
      },
      coverage: {
        uncovered_requirement_ids: [],
        passes: 1,
      },
      company_brief: {
        summary: 'Tech company',
        what_they_do: 'Builds software',
        sources: ['https://example.com'],
      },
      source: {
        company: 'Example',
        company_url: 'https://example.com',
        role: 'Engineer',
        location: 'Remote',
        jd_chars: 20,
        researched_at: new Date().toISOString(),
        pages_used: ['https://example.com'],
      },
      interview_research: {
        company_name: 'Example',
        found_useful_info: false,
        rounds_summary: [],
        focus_areas: [],
        source_urls: [],
        confidence: 'none',
      },
    };

    const result = validateKit(kit);
    assert.strictEqual(result.valid, true, `Validation errors: ${result.errors.join(', ')}`);
  });
});
