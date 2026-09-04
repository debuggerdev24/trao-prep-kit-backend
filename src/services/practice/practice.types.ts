import type { Flashcard } from '../../domain/kit.types.js';

export type ConfidenceInput = 'low' | 'medium' | 'high' | 1 | 2 | 3;
export type NormalizedConfidence = 'low' | 'medium' | 'high';

export interface CardRatingInput {
  cardId: string;
  confidence: ConfidenceInput;
}

export interface CardProgressDTO {
  cardId: string;
  confidence: NormalizedConfidence;
  rating: 1 | 2 | 3;
  reviewCount: number;
  lastReviewedAt: string;
}

export interface PracticeProgressSummary {
  kitId: string;
  totalCards: number;
  cardsCovered: number;
  cardsRemaining: number;
  needReviewCount: number; // low / 1
  goodCount: number;       // medium / 2
  masteredCount: number;   // high / 3
  totalSessions: number;
  lastSessionAt?: string;
  cardRatings: Record<string, CardProgressDTO>;
  recommendedCardOrder: string[]; // card IDs sorted: unreviewed first, then low, medium, high
}

export type WeakSpotLabel = 'strong' | 'medium' | 'weak' | 'unpracticed';

export interface WeakSpotTopic {
  requirement_id: string;
  label: string;
  kind: string;
  priority: string;
  overall_confidence: WeakSpotLabel;
  confidence_score: number; // 0.0–1.0
  cards_total: number;
  cards_practiced: number;
  cards_remaining: number;
  average_rating: number; // 1–3 scale
  recommendation_rank: number; // 1 = highest priority to study
  reason: string;
}

export interface CategoryConfidence {
  category: string;
  overall_confidence: WeakSpotLabel;
  confidence_score: number;
  topics_total: number;
  topics_practiced: number;
  cards_total: number;
  cards_practiced: number;
  average_rating: number;
}

export interface WeakSpotsAnalysis {
  kit_id: string;
  total_requirements: number;
  total_flashcards: number;
  total_practiced: number;
  total_remaining: number;
  overall_confidence: WeakSpotLabel;
  overall_score: number; // 0.0–1.0
  topics: WeakSpotTopic[];
  categories: CategoryConfidence[];
  recommended_next: string[]; // requirement_ids in priority order
  recommended_reason: string;
  strongest_topics: string[]; // requirement_ids
  weakest_topics: string[]; // requirement_ids
  generated_at: string;
}
