import { z } from 'zod';
import { contentPillarSchema, ctaModeSchema, learnerStageSchema } from '../product/content-fit-profile.js';
import { productClaimIdSchema, productModuleIdSchema } from '../product/product-profile.js';
import {
  publishedAtQualitySchema,
  sourceKindSchema,
  sourcePlatformSchema,
  usageModeSchema,
} from '../types.js';

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const nonEmptyText = boundedText(2_000);
const materialIdSchema = z.string().regex(/^mat_[a-f0-9]{12}$/);
const nullableMetricSchema = z.number().int().nonnegative().nullable();
export const evidenceReferenceSchema = z.string().regex(/^(material|experiment|project|case):[a-zA-Z0-9._-]+$/);

export const topicMaterialRoleSchema = z.enum([
  'fact_source',
  'trend_signal',
  'structure_inspiration',
  'reference_only',
  'restricted_inspiration_only',
]);

export const noPublishReasonCodeSchema = z.enum([
  'no_usable_materials',
  'no_candidate_above_threshold',
  'insufficient_fact_evidence',
  'duplicate_recent_topic',
  'weak_user_value',
  'weak_actionability',
  'weak_product_or_account_fit',
  'all_candidates_hard_rejected',
]);

export const topicIntelligenceConfigSchema = z.strictObject({
  version: z.literal(1),
  timezone: z.literal('Asia/Shanghai'),
  schedule: z.strictObject({
    target_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
  input: z.strictObject({
    lookback_hours: z.number().int().min(1).max(168),
    history_window_days: z.number().int().min(1).max(90),
    max_total_materials: z.number().int().min(1).max(60),
    max_cloud_materials: z.number().int().min(0).max(30),
    max_twitter_materials: z.number().int().min(0).max(25),
    max_weixin_resolved_materials: z.number().int().min(0).max(8),
    max_weixin_restricted_materials: z.number().int().min(0).max(8),
    max_per_author: z.number().int().min(1).max(5),
    max_per_query: z.number().int().min(1).max(10),
    max_per_cluster: z.number().int().min(1).max(5),
    excerpt_max_chars: z.number().int().min(100).max(500),
    restricted_excerpt_max_chars: z.number().int().min(50).max(300),
    max_model_input_chars: z.number().int().min(10_000).max(80_000),
  }),
  candidates: z.strictObject({
    maximum: z.number().int().min(1).max(3),
    approval_score: z.literal(80),
    close_score_tie_range: z.number().int().min(0).max(3),
  }),
  history: z.strictObject({
    exact_signature_window_days: z.number().int().min(1).max(30),
    similarity_window_days: z.number().int().min(1).max(30),
    token_similarity_threshold: z.number().min(0.5).max(0.9),
  }),
  model: z.strictObject({
    maximum_calls_per_run: z.number().int().min(1).max(2),
    repair_attempts: z.number().int().min(0).max(1),
    prompt_version: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  }),
  output: z.strictObject({
    maximum_research_questions: z.number().int().min(0).max(5),
    maximum_experiment_steps: z.number().int().min(0).max(5),
    maximum_supported_claims: z.number().int().min(0).max(5),
  }),
}).superRefine((config, context) => {
  if (config.input.restricted_excerpt_max_chars > config.input.excerpt_max_chars) {
    context.addIssue({ code: 'custom', message: 'Restricted excerpt limit cannot exceed the normal excerpt limit' });
  }
  for (const [name, value] of Object.entries({
    max_cloud_materials: config.input.max_cloud_materials,
    max_twitter_materials: config.input.max_twitter_materials,
    max_weixin_resolved_materials: config.input.max_weixin_resolved_materials,
    max_weixin_restricted_materials: config.input.max_weixin_restricted_materials,
  })) {
    if (value > config.input.max_total_materials) {
      context.addIssue({ code: 'custom', message: `${name} cannot exceed max_total_materials` });
    }
  }
});

export const topicMaterialCardSchema = z.strictObject({
  material_id: materialIdSchema,
  source_platform: sourcePlatformSchema,
  source_kind: sourceKindSchema,
  role: topicMaterialRoleSchema,
  title: boundedText(1_000),
  excerpt: z.string().max(500),
  author_name: z.string().max(300),
  published_at: z.iso.datetime().nullable(),
  published_at_quality: publishedAtQualitySchema,
  canonical_url: z.url().nullable(),
  query_id: z.string().max(300),
  query_text: z.string().max(500),
  engagement: z.strictObject({
    views: nullableMetricSchema,
    likes: nullableMetricSchema,
    comments: nullableMetricSchema,
    reposts: nullableMetricSchema,
    quotes: nullableMetricSchema,
    bookmarks: nullableMetricSchema,
  }),
  usage_mode: usageModeSchema,
  restrictions: z.array(z.string().max(300)).max(12),
});

export const supportedClaimSchema = z.strictObject({
  claim: boundedText(500),
  fact_source_ids: z.array(materialIdSchema).min(1).max(5),
});

export const productClaimEvidenceSchema = z.strictObject({
  claim_id: productClaimIdSchema,
  evidence_refs: z.array(evidenceReferenceSchema).max(5),
});

export const topicScoreSchema = z.strictObject({
  pain_score: z.number().int().min(0).max(25),
  actionability_score: z.number().int().min(0).max(20),
  demonstrability_score: z.number().int().min(0).max(15),
  evidence_score: z.number().int().min(0).max(15),
  engagement_potential_score: z.number().int().min(0).max(15),
  product_fit_score: z.number().int().min(0).max(10),
});

export const topicScoreReasonsSchema = z.strictObject({
  pain_score: boundedText(300),
  actionability_score: boundedText(300),
  demonstrability_score: boundedText(300),
  evidence_score: boundedText(300),
  engagement_potential_score: boundedText(300),
  product_fit_score: boundedText(300),
});

export const platformPlanSchema = z.strictObject({
  wechat_article_type: z.enum(['tutorial', 'analysis', 'case_breakdown', 'opinion', 'checklist']),
  wechat_required_evidence: z.array(boundedText(300)).max(5),
  wechat_needs_step_images: z.boolean(),
  wechat_needs_screenshots_or_experiment: z.boolean(),
  x_format: z.enum(['single_post', 'thread', 'debate_prompt']),
});

const commonCandidateShape = {
  candidate_id: z.string().regex(/^candidate_[a-z0-9_-]{1,50}$/),
  working_title: boundedText(200),
  one_sentence_promise: boundedText(500),
  target_segment: boundedText(300),
  learner_stage: learnerStageSchema,
  trigger_scenario: boundedText(500),
  user_problem: boundedText(500),
  wrong_current_behavior: boundedText(500),
  real_task: boundedText(500),
  minimum_result: boundedText(500),
  content_pillar: contentPillarSchema,
  primary_product_module_id: productModuleIdSchema,
  supporting_product_module_ids: z.array(productModuleIdSchema).max(5),
  funnel_role: z.enum(['traffic', 'trust', 'lead_generation']),
  core_angle: boundedText(500),
  why_now: boundedText(500),
  proof_format: boundedText(300),
  time_sensitive: z.boolean(),
  fact_source_ids: z.array(materialIdSchema).max(10),
  trend_signal_ids: z.array(materialIdSchema).max(10),
  structure_inspiration_ids: z.array(materialIdSchema).max(10),
  restricted_inspiration_ids: z.array(materialIdSchema).max(8),
  supported_claims: z.array(supportedClaimSchema).max(5),
  research_questions: z.array(boundedText(500)).max(5),
  requires_research: z.boolean(),
  requires_experiment: z.boolean(),
  experiment_plan: z.array(boundedText(500)).max(5),
  cta_mode: ctaModeSchema,
  product_claim_ids: z.array(productClaimIdSchema).max(10),
  product_claim_evidence: z.array(productClaimEvidenceSchema).max(10),
  price_refresh_required: z.boolean(),
  risk_flags: z.array(boundedText(300)).max(20),
  hard_reject_reasons: z.array(boundedText(300)).max(20),
  scores: topicScoreSchema,
  score_reasons: topicScoreReasonsSchema,
  decision_reason: boundedText(800),
  novelty_delta: z.string().max(500),
  new_evidence_refs: z.array(evidenceReferenceSchema).max(10),
  platform_plan: platformPlanSchema,
};

export const topicCandidateProposalSchema = z.strictObject(commonCandidateShape);

export const topicCandidateSchema = topicCandidateProposalSchema.extend({
  scores: topicScoreSchema.extend({ total_score: z.number().int().min(0).max(100) }),
  topic_signature: z.string().regex(/^[a-f0-9]{64}$/),
  effective_product_fit_cap: z.number().int().min(0).max(10),
  product_fit_cap_applied: z.boolean(),
  cta_adjusted_from: ctaModeSchema.nullable(),
  evaluation_status: z.enum(['approved', 'rejected']),
});

export const topicJudgeProviderResultSchema = z.strictObject({
  candidates: z.array(topicCandidateProposalSchema).max(3),
  no_publish_reason_code: noPublishReasonCodeSchema.nullable(),
  no_publish_reason: z.string().max(1_000).nullable(),
});

export const topicInputSummarySchema = z.strictObject({
  total_before_filter: z.number().int().nonnegative(),
  eligible_total: z.number().int().nonnegative(),
  total_after_filter: z.number().int().nonnegative(),
  cloud_count: z.number().int().nonnegative(),
  twitter_count: z.number().int().nonnegative(),
  weixin_resolved_count: z.number().int().nonnegative(),
  restricted_count: z.number().int().nonnegative(),
  fact_source_count: z.number().int().nonnegative(),
  trend_signal_count: z.number().int().nonnegative(),
  structure_inspiration_count: z.number().int().nonnegative(),
  eligible_by_bucket: z.strictObject({
    cloud: z.number().int().nonnegative(),
    twitter: z.number().int().nonnegative(),
    weixin_resolved: z.number().int().nonnegative(),
    weixin_restricted: z.number().int().nonnegative(),
  }),
  selected_by_bucket: z.strictObject({
    cloud: z.number().int().nonnegative(),
    twitter: z.number().int().nonnegative(),
    weixin_resolved: z.number().int().nonnegative(),
    weixin_restricted: z.number().int().nonnegative(),
  }),
  dropped_by_reason: z.strictObject({
    duplicate: z.number().int().nonnegative(),
    outside_window: z.number().int().nonnegative(),
    invalid_status: z.number().int().nonnegative(),
    invalid_url: z.number().int().nonnegative(),
    invalid_material: z.number().int().nonnegative(),
    sensitive_content: z.number().int().nonnegative(),
    author_limit: z.number().int().nonnegative(),
    query_limit: z.number().int().nonnegative(),
    cluster_limit: z.number().int().nonnegative(),
    bucket_limit: z.number().int().nonnegative(),
    character_limit: z.number().int().nonnegative(),
  }),
  source_gaps: z.array(z.enum(['browser_missing', 'cloud_missing'])),
});

const modelUsageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
  total_tokens: z.number().int().nonnegative().nullable(),
});

export const topicDecisionSchema = z.strictObject({
  version: z.literal(1),
  decision_date: z.iso.date(),
  run_id: z.string().regex(/^topic_[0-9T_-]+Z$/),
  status: z.enum(['success', 'failed']),
  decision: z.enum(['SELECT_TOPIC', 'NO_PUBLISH']).nullable(),
  prompt_version: z.string().min(1),
  input_hash: z.string().regex(/^[a-f0-9]{64}$/),
  input_summary: topicInputSummarySchema,
  selected_topic: topicCandidateSchema.nullable(),
  evaluated_candidates: z.array(topicCandidateSchema).max(3),
  no_publish_reason_code: noPublishReasonCodeSchema.nullable(),
  no_publish_reason: z.string().max(1_000).nullable(),
  model: z.strictObject({
    provider: z.string().min(1),
    model: z.string(),
    calls: z.number().int().min(0).max(2),
    duration_ms: z.number().int().nonnegative(),
    usage: modelUsageSchema.nullable(),
  }),
  error_code: z.enum([
    'model_unavailable',
    'model_timeout',
    'model_output_invalid',
    'configuration_invalid',
    'schema_invalid',
    'file_read_failed',
  ]).nullable(),
  error_message_safe: z.string().max(1_000).nullable(),
  created_at: z.iso.datetime(),
}).superRefine((decision, context) => {
  if (decision.status === 'success' && decision.decision === 'SELECT_TOPIC' && decision.selected_topic === null) {
    context.addIssue({ code: 'custom', path: ['selected_topic'], message: 'SELECT_TOPIC requires selected_topic' });
  }
  if (decision.status === 'success' && decision.decision === 'NO_PUBLISH') {
    if (decision.selected_topic !== null) {
      context.addIssue({ code: 'custom', path: ['selected_topic'], message: 'NO_PUBLISH requires selected_topic=null' });
    }
    if (decision.no_publish_reason_code === null || decision.no_publish_reason === null) {
      context.addIssue({ code: 'custom', path: ['no_publish_reason'], message: 'NO_PUBLISH requires a reason' });
    }
  }
  if (decision.status === 'failed') {
    if (decision.decision !== null || decision.selected_topic !== null) {
      context.addIssue({ code: 'custom', path: ['decision'], message: 'Failed runs cannot contain a business decision' });
    }
    if (decision.error_code === null) {
      context.addIssue({ code: 'custom', path: ['error_code'], message: 'Failed runs require error_code' });
    }
  } else if (decision.decision === null) {
    context.addIssue({ code: 'custom', path: ['decision'], message: 'Successful runs require a business decision' });
  }
});

export type TopicIntelligenceConfig = z.infer<typeof topicIntelligenceConfigSchema>;
export type TopicMaterialRole = z.infer<typeof topicMaterialRoleSchema>;
export type TopicMaterialCard = z.infer<typeof topicMaterialCardSchema>;
export type TopicCandidateProposal = z.infer<typeof topicCandidateProposalSchema>;
export type TopicCandidate = z.infer<typeof topicCandidateSchema>;
export type TopicJudgeProviderResult = z.infer<typeof topicJudgeProviderResultSchema>;
export type TopicInputSummary = z.infer<typeof topicInputSummarySchema>;
export type TopicDecision = z.infer<typeof topicDecisionSchema>;
export type NoPublishReasonCode = z.infer<typeof noPublishReasonCodeSchema>;
