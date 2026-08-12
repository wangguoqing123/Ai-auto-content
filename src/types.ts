import { z } from 'zod';

export const sourceTierSchema = z.enum(['primary', 'secondary', 'unverified']);
export const sourcePlatformSchema = z.enum(['twitter', 'xiaohongshu', 'weixin', 'aihot', 'rss']);
export const sourceKindSchema = z.enum(['official', 'news', 'ugc']);
export const publishedAtQualitySchema = z.enum(['exact', 'inferred', 'unknown']);
export const metricQualitySchema = z.enum(['complete', 'partial', 'unavailable']);
export const usageModeSchema = z.enum(['fact_source', 'trend_signal', 'structure_inspiration', 'reference_only']);
export const viralConfidenceSchema = z.enum(['verified', 'likely', 'candidate', 'unverified']);

export const engagementSchema = z.object({
  views: z.number().int().nonnegative().nullable(),
  likes: z.number().int().nonnegative().nullable(),
  comments: z.number().int().nonnegative().nullable(),
  shares: z.number().int().nonnegative().nullable(),
  reposts: z.number().int().nonnegative().nullable(),
  quotes: z.number().int().nonnegative().nullable(),
  bookmarks: z.number().int().nonnegative().nullable(),
  collects: z.number().int().nonnegative().nullable(),
});

export const unifiedMaterialSchema = z.object({
  material_id: z.string().regex(/^mat_[a-f0-9]{12}$/),
  source_platform: sourcePlatformSchema,
  source_kind: sourceKindSchema,
  collector: z.string().min(1),
  query_id: z.string(),
  query_text: z.string(),
  search_rank: z.number().int().positive().nullable(),
  source_item_id: z.string(),
  author_name: z.string(),
  author_followers: z.number().int().nonnegative().nullable(),
  title: z.string().min(1),
  excerpt: z.string(),
  source_url: z.string().min(1),
  content_path: z.string().nullable(),
  published_at: z.iso.datetime().nullable(),
  published_at_quality: publishedAtQualitySchema,
  collected_at: z.iso.datetime(),
  engagement: engagementSchema,
  metric_quality: metricQualitySchema,
  usage_mode: usageModeSchema,
  viral_confidence: viralConfidenceSchema,
  status: z.enum(['accepted', 'rejected', 'quarantined']),
  rejection_reasons: z.array(z.string()),
});

export const sourceConfigSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  type: z.enum(['rss', 'aihot']),
  url: z.string().url(),
  enabled: z.boolean(),
  language: z.string().min(2),
  category: z.string().min(1),
  source_tier: sourceTierSchema,
  audience_fit: z.array(z.string().min(1)).min(1),
});

export const sourcesFileSchema = z.object({
  version: z.number().int().positive(),
  verified_at: z.iso.date(),
  sources: z.array(sourceConfigSchema).min(1),
}).superRefine(({ sources }, context) => {
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.id)) {
      context.addIssue({ code: 'custom', message: `Duplicate source id: ${source.id}` });
    }
    seen.add(source.id);
  }
});

const keywordGroupSchema = z.object({
  weight: z.number(),
  keywords: z.array(z.string().min(1)).min(1),
});

export const scoringConfigSchema = z.object({
  version: z.number().int().positive(),
  evidence_scores: z.record(sourceTierSchema, z.number().min(0).max(100)),
  freshness_scores: z.object({
    within_24_hours: z.number().min(0).max(100),
    within_3_days: z.number().min(0).max(100),
    within_7_days: z.number().min(0).max(100),
    within_14_days: z.number().min(0).max(100),
    older_or_unknown: z.number().min(0).max(100),
  }),
  relevance: z.object({
    base_score: z.number(),
    audience_fit_bonus: z.record(z.string(), z.number()),
    category_bonus: z.record(z.string(), z.number()),
    positive_keyword_groups: z.record(z.string(), keywordGroupSchema),
    negative_keyword_groups: z.record(z.string(), keywordGroupSchema),
  }),
  overall_weights: z.object({
    relevance: z.number().min(0).max(1),
    freshness: z.number().min(0).max(1),
    evidence: z.number().min(0).max(1),
  }).refine((weights) => Math.abs(weights.relevance + weights.freshness + weights.evidence - 1) < 0.0001, {
    message: 'Overall weights must sum to 1',
  }),
  thresholds: z.object({
    minimum_relevance: z.number().min(0).max(100),
    minimum_overall: z.number().min(0).max(100),
  }),
  collector: z.object({
    concurrency: z.number().int().min(1).max(10),
    timeout_ms: z.number().int().min(1).max(15_000),
    retries: z.number().int().min(0).max(2),
    max_excerpt_chars: z.number().int().min(100).max(1_000),
    user_agent: z.string().min(1),
  }),
});

export const materialSchema = unifiedMaterialSchema.extend({
  source_id: z.string().min(1),
  source_name: z.string().min(1),
  source_type: z.enum(['rss', 'opencli', 'api']),
  source_tier: sourceTierSchema,
  category: z.string().min(1),
  canonical_url: z.string().min(1),
  author: z.string().nullable(),
  language: z.string().min(2),
  excerpt: z.string().max(1_000),
  target_users: z.array(z.string().min(1)),
  tags: z.array(z.string().min(1)),
  relevance_score: z.number().int().min(0).max(100),
  freshness_score: z.number().int().min(0).max(100),
  evidence_score: z.number().int().min(0).max(100),
  overall_score: z.number().int().min(0).max(100),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  content_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export const seenMaterialsSchema = z.object({
  version: z.literal(1),
  url_fingerprints: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  content_fingerprints: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  updated_at: z.iso.datetime().nullable(),
});

export const sourceRunSchema = z.object({
  source_id: z.string(),
  source_name: z.string(),
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime(),
  status: z.enum(['success', 'failed']),
  items_fetched: z.number().int().nonnegative(),
  items_new: z.number().int().nonnegative(),
  items_duplicate: z.number().int().nonnegative(),
  items_rejected: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

export const runLogSchema = z.object({
  run_id: z.string().regex(/^run_\d{8}_\d{6}$/),
  collection_date: z.iso.date(),
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime(),
  status: z.enum(['success', 'partial_success', 'failed']),
  sources_total: z.number().int().nonnegative(),
  sources_succeeded: z.number().int().nonnegative(),
  sources_failed: z.number().int().nonnegative(),
  items_fetched: z.number().int().nonnegative(),
  items_new: z.number().int().nonnegative(),
  items_duplicate: z.number().int().nonnegative(),
  items_rejected: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  failures: z.array(z.object({ source_id: z.string(), source_name: z.string(), error: z.string() })),
  source_runs: z.array(sourceRunSchema),
});

export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export type SourcesFile = z.infer<typeof sourcesFileSchema>;
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;
export type UnifiedMaterial = z.infer<typeof unifiedMaterialSchema>;
export type Material = z.infer<typeof materialSchema>;
export type SeenMaterials = z.infer<typeof seenMaterialsSchema>;
export type SourceRun = z.infer<typeof sourceRunSchema>;
export type RunLog = z.infer<typeof runLogSchema>;

export interface RawFeedItem {
  title: string;
  link: string;
  author: string | null;
  publishedAt: string | null;
  excerpt: string;
  guid: string | null;
}

export interface NormalizedCandidate {
  source: SourceConfig;
  title: string;
  sourceUrl: string;
  canonicalUrl: string;
  author: string | null;
  publishedAt: string | null;
  collectedAt: string;
  excerpt: string;
  urlFingerprint: string;
  contentFingerprint: string;
}

export interface SourceCollectionResult {
  source: SourceConfig;
  items: RawFeedItem[];
  run: SourceRun;
}
