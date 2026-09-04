import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import {
  normalizeConfidence,
  sortCardsByWeakSpots,
  buildProgressSummary,
  recordPracticeSession,
  getPracticeProgress,
} from '../services/practice/index.js';
import { PracticeProgress } from '../models/PracticeProgress.js';
import type { Flashcard } from '../domain/kit.types.js';

const SAMPLE_FLASHCARDS: Flashcard[] = [
  {
    id: 'f1',
    front: 'What is the Virtual DOM?',
    back: 'An in-memory representation of real DOM elements.',
    requirement_ids: ['r1'],
  },
  {
    id: 'f2',
    front: 'Explain React Fiber reconciliation.',
    back: 'Two-phase reconciliation: render/reconciliation and commit.',
    requirement_ids: ['r1'],
  },
  {
    id: 'f3',
    front: 'Describe the STAR method for behavioural questions.',
    back: 'Situation, Task, Action, Result framework.',
    requirement_ids: ['r2'],
  },
  {
    id: 'f4',
    front: 'What is eventual consistency?',
    back: 'Data replicates asynchronously until all replicas converge.',
    requirement_ids: ['r3'],
  },
];

describe('Practice Mode Progress & Weak Spot Prioritization (Phase 12)', () => {
  let isMongoConnected = false;
  const testUserId1 = new mongoose.Types.ObjectId().toString();
  const testUserId2 = new mongoose.Types.ObjectId().toString();
  const testKitId = new mongoose.Types.ObjectId().toString();

  before(async () => {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/trao-test-practice';
    try {
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2000 });
      }
      isMongoConnected = mongoose.connection.readyState === 1;
      if (isMongoConnected) {
        await PracticeProgress.deleteMany({ kitId: new mongoose.Types.ObjectId(testKitId) });
      }
    } catch {
      // MongoDB not running locally in test environment; test unit and deterministic algorithms
      isMongoConnected = false;
    }
  });

  after(async () => {
    if (isMongoConnected) {
      try {
        await PracticeProgress.deleteMany({ kitId: new mongoose.Types.ObjectId(testKitId) });
        await mongoose.disconnect();
      } catch {
        // ignore
      }
    }
  });

  describe('Confidence Normalization', () => {
    it('normalizes low/1, medium/2, high/3 correctly', () => {
      assert.deepStrictEqual(normalizeConfidence('low'), { confidence: 'low', rating: 1 });
      assert.deepStrictEqual(normalizeConfidence(1), { confidence: 'low', rating: 1 });

      assert.deepStrictEqual(normalizeConfidence('medium'), { confidence: 'medium', rating: 2 });
      assert.deepStrictEqual(normalizeConfidence(2), { confidence: 'medium', rating: 2 });

      assert.deepStrictEqual(normalizeConfidence('high'), { confidence: 'high', rating: 3 });
      assert.deepStrictEqual(normalizeConfidence(3), { confidence: 'high', rating: 3 });
    });
  });

  describe('Deterministic Weak Spot Ordering (Cross-Session)', () => {
    it('orders unreviewed cards first, then low confidence (1), then medium (2), then high (3)', () => {
      // User reviewed:
      // f1 -> rating: 3 (high/mastered)
      // f2 -> rating: 1 (low/need review)
      // f3 -> rating: 2 (medium/good)
      // f4 -> unreviewed
      const mockRatings = {
        f1: { cardId: 'f1', confidence: 'high' as const, rating: 3 as const, reviewCount: 1, lastReviewedAt: new Date().toISOString() },
        f2: { cardId: 'f2', confidence: 'low' as const, rating: 1 as const, reviewCount: 1, lastReviewedAt: new Date().toISOString() },
        f3: { cardId: 'f3', confidence: 'medium' as const, rating: 2 as const, reviewCount: 1, lastReviewedAt: new Date().toISOString() },
      };

      const sorted = sortCardsByWeakSpots(SAMPLE_FLASHCARDS, mockRatings);
      const sortedIds = sorted.map((c) => c.id);

      // Expected order:
      // 1. f4 (unreviewed: score 0)
      // 2. f2 (low confidence: score 1)
      // 3. f3 (medium confidence: score 2)
      // 4. f1 (high confidence: score 3)
      assert.deepStrictEqual(sortedIds, ['f4', 'f2', 'f3', 'f1']);
    });

    it('uses review count as tie-breaker for cards with the same confidence', () => {
      // Both f1 and f2 are rating 1, but f2 has been reviewed 3 times, while f1 only once
      const mockRatings = {
        f1: { cardId: 'f1', confidence: 'low' as const, rating: 1 as const, reviewCount: 1, lastReviewedAt: new Date().toISOString() },
        f2: { cardId: 'f2', confidence: 'low' as const, rating: 1 as const, reviewCount: 3, lastReviewedAt: new Date().toISOString() },
      };

      const sorted = sortCardsByWeakSpots([SAMPLE_FLASHCARDS[1], SAMPLE_FLASHCARDS[0]], mockRatings);
      // f1 should precede f2 because reviewCount (1) < reviewCount (3)
      assert.strictEqual(sorted[0].id, 'f1');
      assert.strictEqual(sorted[1].id, 'f2');
    });
  });

  describe('Progress Summary Calculation', () => {
    it('accurately calculates covered, remaining, and confidence breakdown', () => {
      const savedCards = [
        { cardId: 'f1', confidence: 'low' as const, rating: 1 as const, reviewCount: 2, lastReviewedAt: new Date() },
        { cardId: 'f2', confidence: 'medium' as const, rating: 2 as const, reviewCount: 1, lastReviewedAt: new Date() },
      ];

      const summary = buildProgressSummary(testKitId, SAMPLE_FLASHCARDS, savedCards, 2);

      assert.strictEqual(summary.totalCards, 4);
      assert.strictEqual(summary.cardsCovered, 2);
      assert.strictEqual(summary.cardsRemaining, 2);
      assert.strictEqual(summary.needReviewCount, 1);
      assert.strictEqual(summary.goodCount, 1);
      assert.strictEqual(summary.masteredCount, 0);
      assert.strictEqual(summary.totalSessions, 2);

      // Recommended order puts remaining cards (f3, f4) first, then f1 (rating 1), then f2 (rating 2)
      assert.strictEqual(summary.recommendedCardOrder.includes('f3'), true);
      assert.strictEqual(summary.recommendedCardOrder.includes('f4'), true);
      assert.strictEqual(summary.recommendedCardOrder[2], 'f1');
      assert.strictEqual(summary.recommendedCardOrder[3], 'f2');
    });
  });

  describe('Database Persistence & Multi-Session Tracking', () => {
    it('persists session ratings and increments reviewCount on repeated practice', async () => {
      if (!isMongoConnected) {
        console.log('Skipping live DB tests (MongoDB instance not detected)');
        return;
      }

      // Session 1: User rates f1 as low (1) and f2 as medium (2)
      const session1 = await recordPracticeSession(
        testUserId1,
        testKitId,
        [
          { cardId: 'f1', confidence: 1 },
          { cardId: 'f2', confidence: 'medium' },
        ],
        SAMPLE_FLASHCARDS
      );

      assert.strictEqual(session1.totalSessions, 1);
      assert.strictEqual(session1.cardsCovered, 2);
      assert.strictEqual(session1.cardsRemaining, 2);
      assert.strictEqual(session1.cardRatings['f1'].rating, 1);
      assert.strictEqual(session1.cardRatings['f1'].reviewCount, 1);

      // Session 2: User repeats practice, upgrading f1 to high (3)
      const session2 = await recordPracticeSession(
        testUserId1,
        testKitId,
        [
          { cardId: 'f1', confidence: 3 },
          { cardId: 'f3', confidence: 'high' },
        ],
        SAMPLE_FLASHCARDS
      );

      assert.strictEqual(session2.totalSessions, 2);
      assert.strictEqual(session2.cardsCovered, 3);
      assert.strictEqual(session2.cardsRemaining, 1);
      assert.strictEqual(session2.cardRatings['f1'].rating, 3);
      assert.strictEqual(session2.cardRatings['f1'].reviewCount, 2); // review count incremented

      // Retrieve progress
      const fetched = await getPracticeProgress(testUserId1, testKitId, SAMPLE_FLASHCARDS);
      assert.strictEqual(fetched.totalSessions, 2);
      assert.strictEqual(fetched.cardsCovered, 3);
      // f4 was never reviewed, so it must be recommended first
      assert.strictEqual(fetched.recommendedCardOrder[0], 'f4');
    });

    it('enforces user isolation: User A progress does not overwrite User B progress', async () => {
      if (!isMongoConnected) return;

      // User 2 reviews f4 as low (1)
      await recordPracticeSession(
        testUserId2,
        testKitId,
        [{ cardId: 'f4', confidence: 1 }],
        SAMPLE_FLASHCARDS
      );

      const user1Progress = await getPracticeProgress(testUserId1, testKitId, SAMPLE_FLASHCARDS);
      const user2Progress = await getPracticeProgress(testUserId2, testKitId, SAMPLE_FLASHCARDS);

      assert.strictEqual(user1Progress.cardRatings['f4'], undefined);
      assert.strictEqual(user2Progress.cardRatings['f4']?.rating, 1);
    });
  });
});
