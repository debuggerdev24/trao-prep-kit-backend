import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { generateFlashcards } from '../services/flashcards/flashcard.generator.js';
import { MockLanguageModelClient } from '../services/llm/mock.js';
import type { LLMMessage } from '../services/llm/types.js';
import type { Requirement } from '../domain/kit.types.js';

const technicalReq: Requirement = {
  id: 'r1',
  text: '5+ years React experience',
  kind: 'technical',
  priority: 'must',
};

const behaviouralReq: Requirement = {
  id: 'r2',
  text: 'Strong communication skills',
  kind: 'behavioural',
  priority: 'must',
};

const domainReq: Requirement = {
  id: 'r3',
  text: 'Fintech domain knowledge',
  kind: 'domain',
  priority: 'nice',
};

describe('Flashcard Generator (Phase 6)', () => {
  describe('Empty & Edge Cases', () => {
    it('returns empty array when requirements are empty', async () => {
      const result = await generateFlashcards(
        { requirements: [], roleTitle: 'Engineer' },
        { llmClient: new MockLanguageModelClient('{}') }
      );
      assert.deepStrictEqual(result, []);
    });

    it('returns empty array when requirements is undefined', async () => {
      const result = await generateFlashcards(
        { requirements: undefined as unknown as Requirement[], roleTitle: 'Engineer' },
        { llmClient: new MockLanguageModelClient('{}') }
      );
      assert.deepStrictEqual(result, []);
    });
  });

  describe('LLM-based Generation', () => {
    it('generates flashcards with valid requirement ID references', async () => {
      const mockClient = new MockLanguageModelClient(JSON.stringify({
        flashcards: [
          { requirement_ids: ['r1'], front: 'React hooks?', back: 'Use useState/useEffect' },
          { requirement_ids: ['r2'], front: 'Communication?', back: 'STAR method' },
        ],
      }));

      const result = await generateFlashcards(
        { requirements: [technicalReq, behaviouralReq], roleTitle: 'Senior Engineer' },
        { llmClient: mockClient }
      );

      assert.ok(result.length >= 2);
      assert.strictEqual(result[0].id, 'f1');
      assert.strictEqual(result[1].id, 'f2');
      assert.ok(result[0].requirement_ids.includes('r1'));
      assert.ok(result[1].requirement_ids.includes('r2'));
      assert.ok(result[0].front.length > 0);
      assert.ok(result[0].back.length > 0);
    });

    it('assigns sequential stable IDs f1, f2, f3...', async () => {
      const mockClient = new MockLanguageModelClient(JSON.stringify({
        flashcards: [
          { requirement_ids: ['r1'], front: 'Q1', back: 'A1' },
          { requirement_ids: ['r2'], front: 'Q2', back: 'A2' },
          { requirement_ids: ['r3'], front: 'Q3', back: 'A3' },
        ],
      }));

      const result = await generateFlashcards(
        { requirements: [technicalReq, behaviouralReq, domainReq], roleTitle: 'Engineer' },
        { llmClient: mockClient }
      );

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].id, 'f1');
      assert.strictEqual(result[1].id, 'f2');
      assert.strictEqual(result[2].id, 'f3');
    });

    it('handles bare-array LLM responses (no wrapper)', async () => {
      const mockClient = new MockLanguageModelClient(JSON.stringify([
        { requirement_ids: ['r1'], front: 'React?', back: 'Hooks' },
      ]));

      const result = await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Engineer' },
        { llmClient: mockClient }
      );

      assert.ok(result.length >= 1);
      assert.strictEqual(result[0].id, 'f1');
    });

    it('sanitizes markdown-wrapped JSON responses', async () => {
      const mockClient = new MockLanguageModelClient(
        '```json\n' + JSON.stringify({
          flashcards: [{ requirement_ids: ['r1'], front: 'React?', back: 'Hooks' }],
        }) + '\n```'
      );

      const result = await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Engineer' },
        { llmClient: mockClient }
      );

      assert.ok(result.length >= 1);
    });
  });

  describe('Anti-Hallucination Guard', () => {
    it('filters out invalid requirement IDs while keeping valid ones', async () => {
      const mockClient = new MockLanguageModelClient(JSON.stringify({
        flashcards: [
          { requirement_ids: ['r1', 'FAKE_ID'], front: 'Mixed IDs?', back: 'Answer' },
        ],
      }));

      const result = await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Engineer' },
        { llmClient: mockClient }
      );

      assert.ok(result.length >= 1);
      assert.deepStrictEqual(result[0].requirement_ids, ['r1']);
    });

    it('discards flashcards referencing only invalid requirement IDs', async () => {
      const mockClient = new MockLanguageModelClient(JSON.stringify({
        flashcards: [
          { requirement_ids: ['r1'], front: 'Valid?', back: 'Answer' },
          { requirement_ids: ['FAKE_ID'], front: 'Fake?', back: 'Answer' },
        ],
      }));

      const result = await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Engineer' },
        { llmClient: mockClient }
      );

      assert.strictEqual(result.length, 1);
      assert.deepStrictEqual(result[0].requirement_ids, ['r1']);
    });

    it('falls back to deterministic when all cards reference invalid IDs', async () => {
      const mockClient = new MockLanguageModelClient(JSON.stringify({
        flashcards: [
          { requirement_ids: ['FAKE1'], front: 'Fake?', back: 'Answer' },
          { requirement_ids: ['FAKE2'], front: 'Fake2?', back: 'Answer' },
        ],
      }));

      const result = await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Engineer' },
        { llmClient: mockClient }
      );

      // Should fall back to deterministic which generates from requirements
      assert.ok(result.length >= 1);
      assert.strictEqual(result[0].id, 'f1');
      assert.ok(result[0].front.includes('Key Technical Principles'));
    });
  });

  describe('Deterministic Fallback', () => {
    it('generates technical flashcards with correct front/back', async () => {
      // Force failure by exhausting retries
      const mockClient = new MockLanguageModelClient(() => {
        throw new Error('LLM unavailable');
      });

      const result = await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Engineer' },
        { llmClient: mockClient, maxRetries: 0 }
      );

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, 'f1');
      assert.ok(result[0].front.includes('Key Technical Principles'));
      assert.ok(result[0].front.includes(technicalReq.text));
      assert.ok(result[0].back.includes(technicalReq.text));
      assert.deepStrictEqual(result[0].requirement_ids, ['r1']);
    });

    it('generates behavioural flashcards with STAR prompt', async () => {
      const mockClient = new MockLanguageModelClient(() => {
        throw new Error('LLM unavailable');
      });

      const result = await generateFlashcards(
        { requirements: [behaviouralReq], roleTitle: 'Engineer' },
        { llmClient: mockClient, maxRetries: 0 }
      );

      assert.strictEqual(result.length, 1);
      assert.ok(result[0].front.includes('STAR Scenario'));
      assert.ok(result[0].back.includes('STAR'));
      assert.deepStrictEqual(result[0].requirement_ids, ['r2']);
    });

    it('generates domain flashcards with domain context', async () => {
      const mockClient = new MockLanguageModelClient(() => {
        throw new Error('LLM unavailable');
      });

      const result = await generateFlashcards(
        { requirements: [domainReq], roleTitle: 'Engineer' },
        { llmClient: mockClient, maxRetries: 0 }
      );

      assert.strictEqual(result.length, 1);
      assert.ok(result[0].front.includes('Domain Context'));
      assert.ok(result[0].back.includes('business'));
      assert.deepStrictEqual(result[0].requirement_ids, ['r3']);
    });

    it('handles multiple requirements in deterministic mode', async () => {
      const mockClient = new MockLanguageModelClient(() => {
        throw new Error('LLM unavailable');
      });

      const result = await generateFlashcards(
        { requirements: [technicalReq, behaviouralReq, domainReq], roleTitle: 'Engineer' },
        { llmClient: mockClient, maxRetries: 0 }
      );

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].id, 'f1');
      assert.strictEqual(result[1].id, 'f2');
      assert.strictEqual(result[2].id, 'f3');
    });
  });

  describe('Malformed LLM Output', () => {
    it('falls back on unparseable JSON', async () => {
      const mockClient = new MockLanguageModelClient('not json at all {{{');

      const result = await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Engineer' },
        { llmClient: mockClient, maxRetries: 0 }
      );

      assert.ok(result.length >= 1);
      assert.ok(result[0].front.includes('Key Technical Principles'));
    });

    it('falls back when LLM returns empty flashcards array', async () => {
      const mockClient = new MockLanguageModelClient(JSON.stringify({ flashcards: [] }));

      const result = await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Engineer' },
        { llmClient: mockClient, maxRetries: 0 }
      );

      assert.ok(result.length >= 1);
      assert.ok(result[0].front.includes('Key Technical Principles'));
    });
  });

  describe('Retry Logic', () => {
    it('retries on transient failures before falling back', async () => {
      let callCount = 0;
      const mockClient = new MockLanguageModelClient(() => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('Transient error');
        }
        return JSON.stringify({
          flashcards: [{ requirement_ids: ['r1'], front: 'Recovered?', back: 'Yes' }],
        });
      });

      const result = await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Engineer' },
        { llmClient: mockClient, maxRetries: 3 }
      );

      assert.ok(result.length >= 1);
      assert.strictEqual(result[0].front, 'Recovered?');
      assert.strictEqual(callCount, 3);
    });

    it('falls back after exhausting retries', async () => {
      let callCount = 0;
      const mockClient = new MockLanguageModelClient(() => {
        callCount++;
        throw new Error('Persistent error');
      });

      const result = await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Engineer' },
        { llmClient: mockClient, maxRetries: 2 }
      );

      // Should fall back to deterministic
      assert.ok(result.length >= 1);
      assert.ok(result[0].front.includes('Key Technical Principles'));
      // Initial attempt + 2 retries = 3 calls
      assert.strictEqual(callCount, 3);
    });
  });

  describe('LLM Prompt Construction', () => {
    it('includes role title in system prompt', async () => {
      const mockClient = new MockLanguageModelClient(JSON.stringify({
        flashcards: [{ requirement_ids: ['r1'], front: 'Q', back: 'A' }],
      }));

      await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Staff Engineer' },
        { llmClient: mockClient }
      );

      const systemMsg = mockClient.lastMessages.find((m) => m.role === 'system');
      assert.ok(systemMsg);
      assert.ok(systemMsg.content.includes('Staff Engineer'));
    });

    it('includes requirement IDs in system prompt for anti-hallucination', async () => {
      const mockClient = new MockLanguageModelClient(JSON.stringify({
        flashcards: [{ requirement_ids: ['r1'], front: 'Q', back: 'A' }],
      }));

      await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Engineer' },
        { llmClient: mockClient }
      );

      const systemMsg = mockClient.lastMessages.find((m) => m.role === 'system');
      assert.ok(systemMsg);
      assert.ok(systemMsg.content.includes('r1'));
    });

    it('sets jsonMode to true', async () => {
      const mockClient = new MockLanguageModelClient(JSON.stringify({
        flashcards: [{ requirement_ids: ['r1'], front: 'Q', back: 'A' }],
      }));

      await generateFlashcards(
        { requirements: [technicalReq], roleTitle: 'Engineer' },
        { llmClient: mockClient }
      );

      assert.strictEqual(mockClient.lastOptions?.jsonMode, true);
    });
  });
});
