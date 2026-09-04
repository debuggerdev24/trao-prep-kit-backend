import type { Flashcard, Requirement, RequirementKind, RequirementPriority } from '../../domain/kit.types.js';
import type { CardProgressDTO, PracticeProgressSummary } from './practice.types.js';
import type {
  CategoryConfidence,
  WeakSpotLabel,
  WeakSpotTopic,
  WeakSpotsAnalysis,
} from './practice.types.js';

const STRONG_THRESHOLD = 0.67;
const MEDIUM_THRESHOLD = 0.34;

function classifyConfidence(score: number, practiced: boolean): WeakSpotLabel {
  if (!practiced) return 'unpracticed';
  if (score >= STRONG_THRESHOLD) return 'strong';
  if (score >= MEDIUM_THRESHOLD) return 'medium';
  return 'weak';
}

function ratingToScore(rating: number): number {
  return rating / 3;
}

interface ReqAggregation {
  requirement_id: string;
  label: string;
  kind: RequirementKind;
  priority: RequirementPriority;
  total_cards: number;
  practiced_cards: number;
  score_sum: number;
  rating_sum: number;
  average_rating: number;
}

function aggregateRequirement(
  req: Requirement,
  flashcards: Flashcard[],
  cardRatings: Record<string, CardProgressDTO>
): ReqAggregation {
  const linked = flashcards.filter((fc) => fc.requirement_ids.includes(req.id));
  const total_cards = linked.length;

  let practiced_cards = 0;
  let score_sum = 0;
  let rating_sum = 0;

  for (const card of linked) {
    const progress = cardRatings[card.id];
    if (progress) {
      practiced_cards++;
      score_sum += ratingToScore(progress.rating);
      rating_sum += progress.rating;
    }
  }

  const average_rating = practiced_cards > 0 ? rating_sum / practiced_cards : 0;
  const confidence_score = total_cards > 0 ? score_sum / total_cards : 0;
  const overall_confidence = classifyConfidence(confidence_score, practiced_cards > 0);

  return {
    requirement_id: req.id,
    label: req.text,
    kind: req.kind,
    priority: req.priority,
    total_cards,
    practiced_cards,
    score_sum,
    rating_sum,
    average_rating,
  };
}

function buildRecommendationReason(
  priority: RequirementPriority,
  label: WeakSpotLabel
): string {
  if (label === 'unpracticed' && priority === 'must') {
    return 'unpracticed must-have requirement — study first';
  }
  if (label === 'weak' && priority === 'must') {
    return 'low confidence on must-have requirement — needs review';
  }
  if (label === 'unpracticed') {
    return 'unpracticed requirement — add to study plan';
  }
  if (label === 'weak') {
    return 'low confidence — review flashcards for this topic';
  }
  if (label === 'medium') {
    return 'moderate confidence — could benefit from additional practice';
  }
  return 'already strong — lower priority for review';
}

function recommendationScore(
  priority: RequirementPriority,
  label: WeakSpotLabel,
  confidence_score: number,
  practiced_cards: number
): [number, number, number, number] {
  // Primary: priority weight (must > nice)
  const priorityWeight = priority === 'must' ? 0 : 1;

  // Secondary: confidence group
  const labelOrder: Record<WeakSpotLabel, number> = {
    unpracticed: 0,
    weak: 1,
    medium: 2,
    strong: 3,
  };

  // Tertiary: within same label, lower score = higher priority
  // Quaternary: fewer practiced cards = higher priority
  return [priorityWeight, labelOrder[label], -confidence_score, -practiced_cards];
}

function compareRecommendation(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function aggregateCategory(
  category: string,
  topics: ReqAggregation[]
): CategoryConfidence {
  const topics_total = topics.length;
  const topics_practiced = topics.filter((t) => t.practiced_cards > 0).length;
  const cards_total = topics.reduce((sum, t) => sum + t.total_cards, 0);
  const cards_practiced = topics.reduce((sum, t) => sum + t.practiced_cards, 0);
  const totalScoreSum = topics.reduce((sum, t) => sum + t.score_sum, 0);
  const average_rating =
    cards_practiced > 0
      ? topics.reduce((sum, t) => sum + t.rating_sum, 0) / cards_practiced
      : 0;
  const confidence_score = cards_total > 0 ? totalScoreSum / cards_total : 0;
  const overall_confidence = classifyConfidence(confidence_score, cards_practiced > 0);

  return {
    category,
    overall_confidence,
    confidence_score,
    topics_total,
    topics_practiced,
    cards_total,
    cards_practiced,
    average_rating,
  };
}

export function analyzeWeakSpots(
  kitId: string,
  requirements: Requirement[],
  flashcards: Flashcard[],
  summary: PracticeProgressSummary
): WeakSpotsAnalysis {
  const cardRatings = summary.cardRatings;

  // Aggregate per-requirement
  const aggregations = requirements.map((req) =>
    aggregateRequirement(req, flashcards, cardRatings)
  );

  // Build topics
  const topics: WeakSpotTopic[] = aggregations.map((agg, idx) => {
    const confidence_score = agg.total_cards > 0 ? agg.score_sum / agg.total_cards : 0;
    const overall_confidence = classifyConfidence(confidence_score, agg.practiced_cards > 0);
    const recommendation_rank = 0; // placeholder, filled below

    return {
      requirement_id: agg.requirement_id,
      label: agg.label,
      kind: agg.kind,
      priority: agg.priority,
      overall_confidence,
      confidence_score,
      cards_total: agg.total_cards,
      cards_practiced: agg.practiced_cards,
      cards_remaining: Math.max(0, agg.total_cards - agg.practiced_cards),
      average_rating: agg.average_rating,
      recommendation_rank,
      reason: buildRecommendationReason(agg.priority, overall_confidence),
    };
  });

  // Sort for recommendation
  const scored = aggregations.map((agg, idx) => {
    const confidence_score = agg.total_cards > 0 ? agg.score_sum / agg.total_cards : 0;
    const overall_confidence = classifyConfidence(confidence_score, agg.practiced_cards > 0);
    return {
      idx,
      score: recommendationScore(
        agg.priority,
        overall_confidence,
        confidence_score,
        agg.practiced_cards
      ),
    };
  });

  scored.sort((a, b) => compareRecommendation(a.score, b.score));

  const recommended_next: string[] = [];
  scored.forEach((s, rank) => {
    const topic = topics[s.idx];
    topic.recommendation_rank = rank + 1;
    recommended_next.push(topic.requirement_id);
  });

  // Categories
  const kindMap = new Map<string, ReqAggregation[]>();
  for (const agg of aggregations) {
    const key = agg.kind;
    if (!kindMap.has(key)) kindMap.set(key, []);
    kindMap.get(key)!.push(agg);
  }

  const categories: CategoryConfidence[] = [];
  for (const [kind, reqs] of kindMap) {
    categories.push(aggregateCategory(kind, reqs));
  }
  categories.sort((a, b) => a.confidence_score - b.confidence_score);

  // Strongest / weakest
  const sorted = [...topics].sort((a, b) => a.confidence_score - b.confidence_score);
  const weakest_topics = sorted
    .filter((t) => t.overall_confidence !== 'strong' && t.cards_practiced > 0)
    .map((t) => t.requirement_id);
  const strongest_topics = sorted
    .filter((t) => t.overall_confidence === 'strong')
    .map((t) => t.requirement_id)
    .reverse();

  // Overall stats
  const total_cards_all = flashcards.length;
  const total_practiced = summary.cardsCovered;
  const total_remaining = Math.max(0, total_cards_all - total_practiced);

  const totalScoreSum = aggregations.reduce((sum, a) => sum + a.score_sum, 0);
  const overall_score = total_cards_all > 0 ? totalScoreSum / total_cards_all : 0;
  const overall_confidence = classifyConfidence(overall_score, total_practiced > 0);

  const unpracticed_count = topics.filter(
    (t) => t.overall_confidence === 'unpracticed'
  ).length;

  return {
    kit_id: kitId,
    total_requirements: requirements.length,
    total_flashcards: total_cards_all,
    total_practiced,
    total_remaining,
    overall_confidence,
    overall_score,
    topics,
    categories,
    recommended_next,
    recommended_reason:
      unpracticed_count > 0
        ? `prioritized ${unpracticed_count} unpracticed requirement(s), then weak spots`
        : weakest_topics.length > 0
          ? 'prioritized low-confidence topics that need review'
          : 'all topics show strong confidence — review as needed',
    strongest_topics,
    weakest_topics,
    generated_at: new Date().toISOString(),
  };
}
