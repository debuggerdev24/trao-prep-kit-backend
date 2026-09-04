import { describe, it } from 'node:test';
import assert from 'node:assert';
import { analyzeWeakSpots } from '../services/practice/weak-spots.service.js';
import type { Flashcard, Requirement } from '../domain/kit.types.js';
import type { CardProgressDTO, PracticeProgressSummary } from '../services/practice/practice.types.js';

const REQUIREMENTS: Requirement[] = [
  { id: 'r1', text: 'React component lifecycle', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'STAR method for behavioural questions', kind: 'behavioural', priority: 'must' },
  { id: 'r3', text: 'Eventual consistency in distributed systems', kind: 'domain', priority: 'nice' },
  { id: 'r4', text: 'PostgreSQL query optimization', kind: 'technical', priority: 'nice' },
];

const FLASHCARDS: Flashcard[] = [
  { id: 'f1', front: 'What is the Virtual DOM?', back: 'An in-memory representation.', requirement_ids: ['r1'] },
  { id: 'f2', front: 'Explain React Fiber.', back: 'Two-phase reconciliation.', requirement_ids: ['r1'] },
  { id: 'f3', front: 'Describe the STAR method.', back: 'Situation, Task, Action, Result.', requirement_ids: ['r2'] },
  { id: 'f4', front: 'What is eventual consistency?', back: 'Async replication.', requirement_ids: ['r3'] },
  { id: 'f5', front: 'How to optimize queries?', back: 'Use indexes and analyze plans.', requirement_ids: ['r4'] },
];

function makeProgress(
  cards: Array<{ cardId: string; confidence: 'low' | 'medium' | 'high'; rating: 1 | 2 | 3; reviewCount: number }>
): PracticeProgressSummary {
  const cardRatings: Record<string, CardProgressDTO> = {};
  let needReviewCount = 0;
  let goodCount = 0;
  let masteredCount = 0;

  for (const c of cards) {
    cardRatings[c.cardId] = {
      cardId: c.cardId,
      confidence: c.confidence,
      rating: c.rating,
      reviewCount: c.reviewCount,
      lastReviewedAt: new Date().toISOString(),
    };
    if (c.rating === 1) needReviewCount++;
    else if (c.rating === 2) goodCount++;
    else if (c.rating === 3) masteredCount++;
  }

  const allIds = new Set(FLASHCARDS.map((f) => f.id));
  const coveredIds = Object.keys(cardRatings).filter((id) => allIds.has(id));

  return {
    kitId: 'test-kit',
    totalCards: FLASHCARDS.length,
    cardsCovered: coveredIds.length,
    cardsRemaining: Math.max(0, FLASHCARDS.length - coveredIds.length),
    needReviewCount,
    goodCount,
    masteredCount,
    totalSessions: 1,
    lastSessionAt: new Date().toISOString(),
    cardRatings,
    recommendedCardOrder: FLASHCARDS.map((f) => f.id),
  };
}

describe('Weak Spots Analysis (Phase 15)', () => {
  describe('analyzeWeakSpots', () => {
    it('returns all requirements as topics', () => {
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, makeProgress([]));
      assert.strictEqual(result.topics.length, 4);
      assert.strictEqual(result.kit_id, 'kit-1');
      assert.strictEqual(result.total_requirements, 4);
    });

    it('classifies unpracticed requirements correctly', () => {
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, makeProgress([]));
      for (const topic of result.topics) {
        assert.strictEqual(topic.overall_confidence, 'unpracticed');
        assert.strictEqual(topic.confidence_score, 0);
        assert.strictEqual(topic.cards_practiced, 0);
      }
    });

    it('classifies all-high requirements as strong', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'high', rating: 3, reviewCount: 2 },
        { cardId: 'f2', confidence: 'high', rating: 3, reviewCount: 2 },
      ]);
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      const r1 = result.topics.find((t) => t.requirement_id === 'r1')!;
      assert.strictEqual(r1.overall_confidence, 'strong');
      assert.strictEqual(r1.confidence_score, 1);
    });

    it('classifies low-confidence requirements as weak', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'low', rating: 1, reviewCount: 1 },
        { cardId: 'f2', confidence: 'low', rating: 1, reviewCount: 1 },
      ]);
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      const r1 = result.topics.find((t) => t.requirement_id === 'r1')!;
      assert.strictEqual(r1.overall_confidence, 'weak');
      assert.ok(r1.confidence_score < 0.34);
    });

    it('classifies medium-confidence requirements correctly', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'medium', rating: 2, reviewCount: 1 },
        { cardId: 'f2', confidence: 'medium', rating: 2, reviewCount: 1 },
      ]);
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      const r1 = result.topics.find((t) => t.requirement_id === 'r1')!;
      assert.strictEqual(r1.overall_confidence, 'medium');
      assert.ok(r1.confidence_score >= 0.34 && r1.confidence_score <= 0.67);
    });

    it('prioritizes unpracticed must-have requirements first', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'high', rating: 3, reviewCount: 5 },
        { cardId: 'f2', confidence: 'high', rating: 3, reviewCount: 5 },
        { cardId: 'f3', confidence: 'low', rating: 1, reviewCount: 1 },
      ]);
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      // r3 (unpracticed nice) should come after weak must-have (r2)
      // r4 (unpracticed nice) should come after weak must-have (r2)
      // But unpracticed should come before strong must (r1)
      const recIds = result.recommended_next;
      const r2idx = recIds.indexOf('r2'); // weak must
      const r1idx = recIds.indexOf('r1'); // strong must
      assert.ok(r2idx < r1idx, 'weak must (r2) should be recommended before strong must (r1)');
    });

    it('prioritizes weak must-have over weak nice', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'low', rating: 1, reviewCount: 1 },
        { cardId: 'f2', confidence: 'low', rating: 1, reviewCount: 1 },
        { cardId: 'f4', confidence: 'low', rating: 1, reviewCount: 1 },
      ]);
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      const recIds = result.recommended_next;
      // r1 is weak must, r3 is weak nice
      const r1idx = recIds.indexOf('r1');
      const r3idx = recIds.indexOf('r3');
      assert.ok(r1idx < r3idx, 'weak must (r1) should be recommended before weak nice (r3)');
    });

    it('calculates recommendation_rank sequentially', () => {
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, makeProgress([]));
      const ranks = result.topics.map((t) => t.recommendation_rank).sort((a, b) => a - b);
      assert.deepStrictEqual(ranks, [1, 2, 3, 4]);
    });

    it('provides explainable reason for each topic', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'high', rating: 3, reviewCount: 3 },
      ]);
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      for (const topic of result.topics) {
        assert.ok(typeof topic.reason === 'string');
        assert.ok(topic.reason.length > 10, 'reason should be descriptive');
      }
    });

    it('groups categories by kind', () => {
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, makeProgress([]));
      const kinds = result.categories.map((c) => c.category);
      assert.ok(kinds.includes('technical'));
      assert.ok(kinds.includes('behavioural'));
      assert.ok(kinds.includes('domain'));
    });

    it('sorts categories by confidence score ascending', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'high', rating: 3, reviewCount: 3 },
        { cardId: 'f2', confidence: 'high', rating: 3, reviewCount: 3 },
      ]);
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      for (let i = 1; i < result.categories.length; i++) {
        assert.ok(
          result.categories[i].confidence_score >= result.categories[i - 1].confidence_score,
          'categories should be sorted by confidence ascending'
        );
      }
    });

    it('computes overall stats correctly', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'high', rating: 3, reviewCount: 2 },
        { cardId: 'f3', confidence: 'medium', rating: 2, reviewCount: 1 },
      ]);
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      assert.strictEqual(result.total_flashcards, 5);
      assert.strictEqual(result.total_practiced, 2);
      assert.strictEqual(result.total_remaining, 3);
      assert.ok(result.overall_score > 0);
    });

    it('identifies strongest and weakest topics', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'high', rating: 3, reviewCount: 3 },
        { cardId: 'f2', confidence: 'high', rating: 3, reviewCount: 3 },
        { cardId: 'f3', confidence: 'low', rating: 1, reviewCount: 1 },
      ]);
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      assert.ok(result.strongest_topics.includes('r1'));
      assert.ok(result.weakest_topics.includes('r2'));
    });

    it('handles empty flashcards gracefully', () => {
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, [], makeProgress([]));
      assert.strictEqual(result.total_flashcards, 0);
      assert.strictEqual(result.total_practiced, 0);
      assert.strictEqual(result.overall_score, 0);
      assert.strictEqual(result.overall_confidence, 'unpracticed');
    });

    it('handles requirements with no linked flashcards', () => {
      const reqNoCards: Requirement[] = [
        { id: 'rx', text: 'Quantum computing basics', kind: 'domain', priority: 'nice' },
      ];
      const result = analyzeWeakSpots('kit-1', reqNoCards, FLASHCARDS, makeProgress([]));
      assert.strictEqual(result.topics.length, 1);
      assert.strictEqual(result.topics[0].cards_total, 0);
      assert.strictEqual(result.topics[0].overall_confidence, 'unpracticed');
    });

    it('strongest_topics are sorted by confidence descending', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'high', rating: 3, reviewCount: 3 },
        { cardId: 'f2', confidence: 'medium', rating: 2, reviewCount: 2 },
        { cardId: 'f3', confidence: 'medium', rating: 2, reviewCount: 2 },
        { cardId: 'f4', confidence: 'low', rating: 1, reviewCount: 1 },
      ]);
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      // strongest should include only 'strong' topics, sorted by score desc
      assert.ok(result.strongest_topics.length > 0);
      const r1Topic = result.topics.find((t) => t.requirement_id === 'r1')!;
      assert.strictEqual(r1Topic.overall_confidence, 'strong');
    });

    it('recommended_reason explains the recommendation strategy', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'high', rating: 3, reviewCount: 3 },
      ]);
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      assert.ok(typeof result.recommended_reason === 'string');
      assert.ok(result.recommended_reason.length > 5);
    });

    it('overall_confidence is unpracticed when no cards are rated', () => {
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, makeProgress([]));
      assert.strictEqual(result.overall_confidence, 'unpracticed');
    });

    it('overall_confidence is strong when all practiced cards are high', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'high', rating: 3, reviewCount: 3 },
        { cardId: 'f2', confidence: 'high', rating: 3, reviewCount: 3 },
        { cardId: 'f3', confidence: 'high', rating: 3, reviewCount: 3 },
        { cardId: 'f4', confidence: 'high', rating: 3, reviewCount: 3 },
        { cardId: 'f5', confidence: 'high', rating: 3, reviewCount: 3 },
      ]);
      const result = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      assert.strictEqual(result.overall_confidence, 'strong');
      assert.strictEqual(result.overall_score, 1);
    });

    it('handles mixed confidence across requirements deterministically', () => {
      const progress = makeProgress([
        { cardId: 'f1', confidence: 'high', rating: 3, reviewCount: 3 },
        { cardId: 'f2', confidence: 'high', rating: 3, reviewCount: 3 },
        { cardId: 'f3', confidence: 'low', rating: 1, reviewCount: 1 },
        { cardId: 'f4', confidence: 'medium', rating: 2, reviewCount: 1 },
      ]);
      const result1 = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      const result2 = analyzeWeakSpots('kit-1', REQUIREMENTS, FLASHCARDS, progress);
      // Deterministic: same input → same output
      assert.deepStrictEqual(result1.recommended_next, result2.recommended_next);
      assert.deepStrictEqual(
        result1.topics.map((t) => t.requirement_id),
        result2.topics.map((t) => t.requirement_id)
      );
    });
  });
});
