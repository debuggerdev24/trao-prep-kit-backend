import mongoose from 'mongoose';
import { PracticeProgress, type ICardProgress } from '../../models/PracticeProgress.js';
import type { Flashcard } from '../../domain/kit.types.js';
import type {
  CardProgressDTO,
  CardRatingInput,
  ConfidenceInput,
  NormalizedConfidence,
  PracticeProgressSummary,
} from './practice.types.js';

/**
 * Normalizes string or numeric confidence input into canonical { confidence, rating }.
 */
export function normalizeConfidence(input: ConfidenceInput): {
  confidence: NormalizedConfidence;
  rating: 1 | 2 | 3;
} {
  if (input === 'low' || input === 1) {
    return { confidence: 'low', rating: 1 };
  }
  if (input === 'medium' || input === 2) {
    return { confidence: 'medium', rating: 2 };
  }
  if (input === 'high' || input === 3) {
    return { confidence: 'high', rating: 3 };
  }
  return { confidence: 'medium', rating: 2 };
}

/**
 * Deterministically orders flashcards for the next practice session:
 * 1. Unreviewed cards first (preserves initial order)
 * 2. Low confidence cards (rating: 1 / need review)
 * 3. Medium confidence cards (rating: 2 / good)
 * 4. High confidence cards (rating: 3 / mastered)
 * Tie-breaker: fewest reviews first, then original card position.
 */
export function sortCardsByWeakSpots(
  flashcards: Flashcard[],
  ratingsMap: Record<string, CardProgressDTO>
): Flashcard[] {
  const indexedCards = flashcards.map((card, idx) => ({ card, originalIndex: idx }));

  indexedCards.sort((a, b) => {
    const ratingA = ratingsMap[a.card.id];
    const ratingB = ratingsMap[b.card.id];

    const scoreA = ratingA ? ratingA.rating : 0; // 0 = unreviewed
    const scoreB = ratingB ? ratingB.rating : 0;

    if (scoreA !== scoreB) {
      return scoreA - scoreB; // 0 (unreviewed) first, then 1, then 2, then 3
    }

    // Tie-breaker: review count (least reviewed first)
    const reviewsA = ratingA?.reviewCount ?? 0;
    const reviewsB = ratingB?.reviewCount ?? 0;
    if (reviewsA !== reviewsB) {
      return reviewsA - reviewsB;
    }

    return a.originalIndex - b.originalIndex;
  });

  return indexedCards.map((entry) => entry.card);
}

/**
 * Builds the progress summary and weak-spot deck ordering for a kit.
 */
export function buildProgressSummary(
  kitId: string,
  flashcards: Flashcard[],
  savedCards: ICardProgress[],
  totalSessions: number,
  lastSessionAt?: Date
): PracticeProgressSummary {
  const ratingsMap: Record<string, CardProgressDTO> = {};
  let needReviewCount = 0;
  let goodCount = 0;
  let masteredCount = 0;

  for (const c of savedCards) {
    ratingsMap[c.cardId] = {
      cardId: c.cardId,
      confidence: c.confidence,
      rating: c.rating,
      reviewCount: c.reviewCount,
      lastReviewedAt: c.lastReviewedAt ? c.lastReviewedAt.toISOString() : new Date().toISOString(),
    };

    if (c.rating === 1) needReviewCount++;
    else if (c.rating === 2) goodCount++;
    else if (c.rating === 3) masteredCount++;
  }

  // Cards covered are only those that exist in the current flashcards list
  const flashcardIdSet = new Set(flashcards.map((f) => f.id));
  const validCoveredIds = Object.keys(ratingsMap).filter((id) => flashcardIdSet.has(id));

  const totalCards = flashcards.length;
  const cardsCovered = validCoveredIds.length;
  const cardsRemaining = Math.max(0, totalCards - cardsCovered);

  const sortedDeck = sortCardsByWeakSpots(flashcards, ratingsMap);

  return {
    kitId,
    totalCards,
    cardsCovered,
    cardsRemaining,
    needReviewCount,
    goodCount,
    masteredCount,
    totalSessions,
    lastSessionAt: lastSessionAt ? lastSessionAt.toISOString() : undefined,
    cardRatings: ratingsMap,
    recommendedCardOrder: sortedDeck.map((c) => c.id),
  };
}

/**
 * Persists practice ratings from a study session.
 * Updates review counts, updates timestamps, and increments session count.
 */
export async function recordPracticeSession(
  userId: string,
  kitId: string,
  ratings: CardRatingInput[],
  flashcards: Flashcard[]
): Promise<PracticeProgressSummary> {
  const userOid = new mongoose.Types.ObjectId(userId);
  const kitOid = new mongoose.Types.ObjectId(kitId);

  let doc = await PracticeProgress.findOne({ userId: userOid, kitId: kitOid });
  if (!doc) {
    doc = new PracticeProgress({
      userId: userOid,
      kitId: kitOid,
      cards: [],
      totalSessions: 0,
    });
  }

  // Update or insert card ratings
  const cardMap = new Map<string, ICardProgress>();
  for (const c of doc.cards) {
    cardMap.set(c.cardId, c);
  }

  for (const r of ratings) {
    const { confidence, rating } = normalizeConfidence(r.confidence);
    const existing = cardMap.get(r.cardId);

    if (existing) {
      existing.confidence = confidence;
      existing.rating = rating;
      existing.reviewCount = (existing.reviewCount || 0) + 1;
      existing.lastReviewedAt = new Date();
    } else {
      cardMap.set(r.cardId, {
        cardId: r.cardId,
        confidence,
        rating,
        reviewCount: 1,
        lastReviewedAt: new Date(),
      });
    }
  }

  doc.cards = Array.from(cardMap.values());
  doc.totalSessions = (doc.totalSessions || 0) + 1;
  doc.lastSessionAt = new Date();

  await doc.save();

  return buildProgressSummary(
    kitId,
    flashcards,
    doc.cards,
    doc.totalSessions,
    doc.lastSessionAt
  );
}

/**
 * Retrieves persisted practice progress for a user and kit.
 */
export async function getPracticeProgress(
  userId: string,
  kitId: string,
  flashcards: Flashcard[]
): Promise<PracticeProgressSummary> {
  const userOid = new mongoose.Types.ObjectId(userId);
  const kitOid = new mongoose.Types.ObjectId(kitId);

  const doc = await PracticeProgress.findOne({ userId: userOid, kitId: kitOid });
  if (!doc) {
    return buildProgressSummary(kitId, flashcards, [], 0);
  }

  return buildProgressSummary(
    kitId,
    flashcards,
    doc.cards,
    doc.totalSessions,
    doc.lastSessionAt
  );
}
