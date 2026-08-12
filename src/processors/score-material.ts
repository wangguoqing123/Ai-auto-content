import type { NormalizedCandidate, ScoringConfig } from '../types.js';

export interface ScoreResult {
  relevanceScore: number;
  freshnessScore: number;
  evidenceScore: number;
  overallScore: number;
  tags: string[];
  status: 'accepted' | 'rejected';
  rejectionReasons: string[];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function containsKeyword(haystack: string, keyword: string): boolean {
  return haystack.includes(keyword.toLocaleLowerCase());
}

export function scoreFreshness(publishedAt: string | null, now: Date, config: ScoringConfig): number {
  if (!publishedAt) return config.freshness_scores.older_or_unknown;
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return config.freshness_scores.older_or_unknown;
  const ageHours = Math.max(0, (now.getTime() - published.getTime()) / 3_600_000);
  if (ageHours <= 24) return config.freshness_scores.within_24_hours;
  if (ageHours <= 72) return config.freshness_scores.within_3_days;
  if (ageHours <= 168) return config.freshness_scores.within_7_days;
  if (ageHours <= 336) return config.freshness_scores.within_14_days;
  return config.freshness_scores.older_or_unknown;
}

export function scoreEvidence(sourceTier: NormalizedCandidate['source']['source_tier'], config: ScoringConfig): number {
  return config.evidence_scores[sourceTier];
}

export function scoreRelevance(candidate: NormalizedCandidate, config: ScoringConfig): { score: number; tags: string[] } {
  const text = `${candidate.title} ${candidate.excerpt}`.normalize('NFKC').toLocaleLowerCase();
  let score = config.relevance.base_score;
  const tags: string[] = [];

  for (const targetUser of candidate.source.audience_fit) {
    score += config.relevance.audience_fit_bonus[targetUser] ?? 0;
  }
  score += config.relevance.category_bonus[candidate.source.category] ?? 0;

  for (const [tag, group] of Object.entries(config.relevance.positive_keyword_groups)) {
    if (group.keywords.some((keyword) => containsKeyword(text, keyword))) {
      score += group.weight;
      tags.push(tag);
    }
  }

  for (const [tag, group] of Object.entries(config.relevance.negative_keyword_groups)) {
    if (group.keywords.some((keyword) => containsKeyword(text, keyword))) {
      score += group.weight;
      tags.push(tag);
    }
  }

  tags.push(candidate.source.category);
  return { score: clampScore(score), tags: [...new Set(tags)].sort() };
}

export function scoreMaterial(candidate: NormalizedCandidate, config: ScoringConfig, now: Date): ScoreResult {
  const relevance = scoreRelevance(candidate, config);
  const freshnessScore = scoreFreshness(candidate.publishedAt, now, config);
  const evidenceScore = scoreEvidence(candidate.source.source_tier, config);
  const overallScore = clampScore(
    relevance.score * config.overall_weights.relevance
      + freshnessScore * config.overall_weights.freshness
      + evidenceScore * config.overall_weights.evidence,
  );
  const status = relevance.score >= config.thresholds.minimum_relevance
    && overallScore >= config.thresholds.minimum_overall ? 'accepted' : 'rejected';
  const rejectionReasons: string[] = [];

  if (status === 'rejected') {
    if (relevance.score < config.thresholds.minimum_relevance) rejectionReasons.push('low_relevance');
    if (overallScore < config.thresholds.minimum_overall) rejectionReasons.push('below_overall_threshold');
    if (freshnessScore === config.freshness_scores.older_or_unknown) rejectionReasons.push('stale_or_unknown_publish_date');
    if (evidenceScore === config.evidence_scores.unverified) rejectionReasons.push('unverified_source');
    if (relevance.tags.includes('low_level_research')) rejectionReasons.push('low_level_only');
  }

  return {
    relevanceScore: relevance.score,
    freshnessScore,
    evidenceScore,
    overallScore,
    tags: relevance.tags,
    status,
    rejectionReasons,
  };
}
