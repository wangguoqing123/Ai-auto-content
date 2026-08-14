import { z } from 'zod';
import { contentPillarSchema, ctaModeSchema, learnerStageSchema } from '../product/content-fit-profile.js';
import { productModuleIdSchema } from '../product/product-profile.js';

const nonEmpty = (maximum: number) => z.string().trim().min(1).max(maximum);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const materialIdSchema = z.string().regex(/^mat_[a-f0-9]{12}$/);
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const researchIntelligenceConfigSchema = z.strictObject({
  version: z.literal(1),
  timezone: z.literal('Asia/Shanghai'),
  source_fetch: z.strictObject({
    maximum_sources: z.number().int().min(1).max(5),
    timeout_seconds: z.number().int().min(1).max(60),
    maximum_redirects: z.number().int().min(0).max(5),
    maximum_response_bytes: z.number().int().min(1_024).max(2_097_152),
    maximum_clean_text_chars: z.number().int().min(1_000).max(80_000),
    maximum_committed_quote_chars_per_source: z.number().int().min(1).max(1_500),
    maximum_single_quote_chars: z.number().int().min(1).max(500),
    allowed_content_types: z.array(z.enum([
      'text/html', 'application/xhtml+xml', 'text/plain', 'application/json',
      'application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml',
    ])).min(1),
  }),
  research: z.strictObject({
    maximum_questions: z.number().int().min(1).max(5),
    maximum_verified_claims: z.number().int().min(1).max(8),
    maximum_codex_calls: z.number().int().min(1).max(4),
    repair_attempts: z.number().int().min(0).max(1),
    prompt_version: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  }),
  experiment: z.strictObject({
    enabled: z.boolean(),
    maximum_variants: z.literal(2),
    maximum_acceptance_criteria: z.number().int().min(1).max(8),
    maximum_output_chars_per_variant: z.number().int().min(1_000).max(20_000),
    maximum_experiment_steps: z.number().int().min(1).max(5),
  }),
  schedule: z.strictObject({
    target_time: timeSchema,
    window_start: timeSchema,
    window_end: timeSchema,
    max_attempts: z.number().int().min(1).max(2),
  }),
});

export const experimentAcceptanceCriterionSchema = z.strictObject({
  criterion_id: z.enum([
    'deliverable_present', 'required_fields_complete', 'missing_inputs_explicit', 'executable_next_steps',
    'acceptance_mapped', 'assumptions_bounded', 'strict_output_format', 'no_major_supplementation',
  ]),
  description: nonEmpty(500),
});

export const experimentCatalogTaskSchema = z.strictObject({
  task_id: z.enum([
    'public_notes_to_action_brief',
    'product_request_to_acceptance_checklist',
    'meeting_notes_to_decision_log',
  ]),
  type: z.literal('text_to_text'),
  name: nonEmpty(200),
  description: nonEmpty(1_000),
  synthetic_input: nonEmpty(10_000),
  required_deliverable_fields: z.array(z.enum([
    'title', 'objective', 'decisions', 'actions', 'acceptance_checklist', 'risks',
  ])).min(1).max(8),
  acceptance_criteria: z.array(experimentAcceptanceCriterionSchema).min(1).max(8),
});

export const experimentTaskCatalogSchema = z.strictObject({
  version: z.literal(1),
  tasks: z.array(experimentCatalogTaskSchema).min(3).max(10),
}).superRefine(({ tasks }, context) => {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.task_id)) context.addIssue({ code: 'custom', message: `Duplicate experiment task: ${task.task_id}` });
    ids.add(task.task_id);
    const criteria = task.acceptance_criteria.map(({ criterion_id }) => criterion_id);
    if (new Set(criteria).size !== criteria.length) context.addIssue({ code: 'custom', message: `Duplicate criteria in ${task.task_id}` });
  }
});

export const cleanedSourceSegmentSchema = z.strictObject({
  segment_id: z.string().regex(/^p\d{4}$/),
  heading: z.string().max(500),
  text: nonEmpty(4_000),
});

export const sourceRetrievalMethodSchema = z.enum([
  'canonical_http',
  'official_rss_replay',
  'persisted_official_rss_excerpt',
]);
export const sourceContentScopeSchema = z.enum(['full_page', 'feed_item', 'feed_excerpt']);
export const canonicalFetchStatusSchema = z.enum(['success', 'blocked', 'failed', 'not_attempted']);

export const cleanedSourceSnapshotSchema = z.strictObject({
  source_id: z.string().regex(/^source_[a-f0-9]{12}$/),
  material_id: materialIdSchema,
  title: z.string().max(1_000),
  author: z.string().max(500),
  final_url: z.url(),
  content_type: nonEmpty(200),
  content_sha256: sha256Schema,
  retrieved_at: z.iso.datetime(),
  retrieval_method: sourceRetrievalMethodSchema,
  content_scope: sourceContentScopeSchema,
  retrieval_url: z.url().nullable(),
  canonical_fetch_status: canonicalFetchStatusSchema,
  canonical_http_status: z.number().int().min(100).max(599).nullable(),
  fallback_reason: z.string().max(1_000).nullable(),
  snapshot_collected_at: z.iso.datetime().nullable(),
  segments: z.array(cleanedSourceSegmentSchema).min(1),
});

export const researchClaimSchema = z.strictObject({
  claim_id: z.string().regex(/^claim_[a-z0-9_-]{1,60}$/),
  claim: nonEmpty(1_000),
  support_status: z.enum(['direct', 'partial', 'unsupported']),
  source_id: z.string().regex(/^source_[a-f0-9]{12}$/).nullable(),
  segment_id: z.string().regex(/^p\d{4}$/).nullable(),
  quote: z.string().max(500),
  scope_limit: z.string().max(1_000),
  notes: z.string().max(1_000),
}).superRefine((claim, context) => {
  if (claim.support_status !== 'unsupported' && (claim.source_id === null || claim.segment_id === null || claim.quote === '')) {
    context.addIssue({ code: 'custom', message: 'Supported claims require source_id, segment_id, and quote' });
  }
  if (claim.support_status === 'partial' && claim.scope_limit === '') {
    context.addIssue({ code: 'custom', path: ['scope_limit'], message: 'Partial claims require scope_limit' });
  }
  if (claim.support_status === 'unsupported' && (claim.source_id !== null || claim.segment_id !== null || claim.quote !== '')) {
    context.addIssue({ code: 'custom', message: 'Unsupported claims cannot contain a source quote' });
  }
});

export const researchAnswerSchema = z.strictObject({
  question: nonEmpty(1_000),
  answer_status: z.enum(['answered', 'partial', 'unanswered']),
  gap_impact: z.enum(['none', 'non_blocking', 'blocking']),
  answer: z.string().max(4_000),
  supporting_claim_ids: z.array(z.string().regex(/^claim_[a-z0-9_-]{1,60}$/)).max(8),
  remaining_gap: z.string().max(2_000),
}).superRefine((answer, context) => {
  if (answer.answer_status === 'answered') {
    if (answer.gap_impact !== 'none' || answer.remaining_gap !== '') {
      context.addIssue({ code: 'custom', message: 'Answered questions require gap_impact=none and no remaining_gap' });
    }
  }
  if (answer.answer_status === 'partial') {
    if (answer.remaining_gap === '') {
      context.addIssue({ code: 'custom', path: ['remaining_gap'], message: 'Partial answers require remaining_gap' });
    }
    if (answer.gap_impact === 'none') {
      context.addIssue({ code: 'custom', path: ['gap_impact'], message: 'Partial answers require non_blocking or blocking impact' });
    }
  }
  if (answer.answer_status === 'unanswered') {
    if (answer.answer !== '') {
      context.addIssue({ code: 'custom', path: ['answer'], message: 'Unanswered questions cannot contain a fabricated answer' });
    }
    if (answer.gap_impact !== 'blocking') {
      context.addIssue({ code: 'custom', path: ['gap_impact'], message: 'Unanswered questions require blocking impact' });
    }
  }
});

export const writingRequirementsSchema = z.strictObject({
  main_promise: nonEmpty(1_000),
  minimum_result: nonEmpty(1_000),
  required_claim_ids: z.array(z.string().regex(/^claim_[a-z0-9_-]{1,60}$/)).max(8),
  required_disclosures: z.array(nonEmpty(1_000)).max(20),
  forbidden_claims: z.array(nonEmpty(1_000)).max(20),
  required_visual_evidence: z.array(nonEmpty(1_000)).max(10),
});

export const researchProviderResultSchema = z.strictObject({
  verified_claims: z.array(researchClaimSchema).max(8),
  research_answers: z.array(researchAnswerSchema).max(5),
  experiment_task_id: experimentCatalogTaskSchema.shape.task_id.nullable(),
  experiment_rationale: z.string().max(1_000),
  writing_requirements: writingRequirementsSchema,
});

export const experimentVariantIdSchema = z.enum(['baseline_chat_request', 'structured_task_card']);

export const experimentOutputSchema = z.strictObject({
  deliverable: z.strictObject({
    title: z.string().max(500),
    objective: z.string().max(2_000),
    decisions: z.array(z.string().max(1_000)).max(20),
    actions: z.array(z.strictObject({
      task: z.string().max(1_000),
      owner: z.string().max(300),
      next_step: z.string().max(1_000),
      acceptance_condition: z.string().max(1_000),
    })).max(20),
    acceptance_checklist: z.array(z.string().max(1_000)).max(20),
    risks: z.array(z.string().max(1_000)).max(20),
  }),
  assumptions: z.array(z.string().max(1_000)).max(20),
  missing_inputs: z.array(z.string().max(1_000)).max(20),
  steps_taken: z.array(z.string().max(1_000)).max(10),
  self_check: z.array(z.strictObject({
    criterion_id: experimentAcceptanceCriterionSchema.shape.criterion_id,
    status: z.enum(['pass', 'fail', 'uncertain']),
    evidence: z.string().max(1_000),
  })).max(8),
});

export const modelUsageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
  total_tokens: z.number().int().nonnegative().nullable(),
});

export const experimentCriterionResultSchema = z.strictObject({
  criterion_id: experimentAcceptanceCriterionSchema.shape.criterion_id,
  status: z.enum(['pass', 'fail', 'uncertain']),
  evidence: z.string().max(1_000),
});

export const experimentResultSchema = z.strictObject({
  variant_id: experimentVariantIdSchema,
  status: z.enum(['success', 'failed']),
  output_parse_status: z.enum(['valid', 'invalid']),
  duration_ms: z.number().int().nonnegative(),
  token_usage: modelUsageSchema.nullable(),
  codex_exit_status: z.enum(['success', 'failed', 'timeout']),
  criterion_results: z.array(experimentCriterionResultSchema).max(8),
  criterion_pass_count: z.number().int().nonnegative(),
  criterion_fail_count: z.number().int().nonnegative(),
  missing_required_fields: z.array(z.string().max(200)).max(8),
  output: experimentOutputSchema.nullable(),
});

export const experimentSpecSchema = z.strictObject({
  task_id: experimentCatalogTaskSchema.shape.task_id,
  type: z.literal('text_to_text'),
  input_sha256: sha256Schema,
  model: nonEmpty(300),
  timeout_ms: z.number().int().positive(),
  variants: z.tuple([
    z.strictObject({ variant_id: z.literal('baseline_chat_request'), prompt_sha256: sha256Schema }),
    z.strictObject({ variant_id: z.literal('structured_task_card'), prompt_sha256: sha256Schema }),
  ]),
});

export const experimentBundleSchema = z.strictObject({
  spec: experimentSpecSchema,
  results: z.tuple([
    experimentResultSchema.extend({ variant_id: z.literal('baseline_chat_request') }),
    experimentResultSchema.extend({ variant_id: z.literal('structured_task_card') }),
  ]),
  observable_differences: z.array(nonEmpty(1_000)).max(10),
  limitations: z.array(nonEmpty(1_000)).min(1).max(10),
});

export const sourceQuoteSchema = z.strictObject({
  claim_id: z.string().regex(/^claim_[a-z0-9_-]{1,60}$/),
  segment_id: z.string().regex(/^p\d{4}$/),
  quote: nonEmpty(500),
});

export const researchSourceManifestSchema = z.strictObject({
  source_id: z.string().regex(/^source_[a-f0-9]{12}$/),
  material_id: materialIdSchema,
  canonical_url: z.url(),
  final_url: z.url().nullable(),
  title: z.string().max(1_000),
  author: z.string().max(500),
  retrieved_at: z.iso.datetime().nullable(),
  content_type: z.string().max(200),
  content_sha256: sha256Schema.nullable(),
  fetch_status: z.enum(['success', 'failed', 'unsupported_content_type']),
  retrieval_method: sourceRetrievalMethodSchema.nullable(),
  content_scope: sourceContentScopeSchema.nullable(),
  retrieval_url: z.url().nullable(),
  canonical_fetch_status: canonicalFetchStatusSchema,
  canonical_http_status: z.number().int().min(100).max(599).nullable(),
  fallback_reason: z.string().max(1_000).nullable(),
  snapshot_collected_at: z.iso.datetime().nullable(),
  selected_quotes: z.array(sourceQuoteSchema).max(8),
  error_code: z.string().max(100).nullable(),
}).superRefine((source, context) => {
  const quoteTotal = source.selected_quotes.reduce((sum, item) => sum + item.quote.length, 0);
  if (quoteTotal > 1_500) context.addIssue({ code: 'custom', path: ['selected_quotes'], message: 'Committed source quotes exceed 1500 characters' });
});

export const researchPackSchema = z.strictObject({
  version: z.literal(1),
  research_date: z.iso.date(),
  run_id: z.string().regex(/^research_[0-9T_-]+Z$/),
  status: z.enum(['success', 'failed']),
  decision: z.enum(['READY_FOR_WRITING', 'RESEARCH_INCOMPLETE', 'NO_TOPIC']).nullable(),
  topic: z.strictObject({
    topic_signature: sha256Schema,
    topic_run_id: z.string().max(200),
    working_title: z.string().max(500),
    learner_stage: learnerStageSchema,
    content_pillar: contentPillarSchema,
    primary_product_module_id: productModuleIdSchema,
    cta_mode: ctaModeSchema,
  }).nullable(),
  input_hash: sha256Schema,
  source_summary: z.strictObject({
    requested: z.number().int().nonnegative(),
    fetched: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unsupported_content_type: z.number().int().nonnegative(),
    canonical_success: z.number().int().nonnegative(),
    canonical_blocked: z.number().int().nonnegative(),
    rss_replay_success: z.number().int().nonnegative(),
    persisted_excerpt_used: z.number().int().nonnegative(),
    unavailable: z.number().int().nonnegative(),
  }),
  sources: z.array(researchSourceManifestSchema).max(5),
  verified_claims: z.array(researchClaimSchema).max(8),
  research_answers: z.array(researchAnswerSchema).max(5),
  experiment: experimentBundleSchema.nullable(),
  writing_requirements: writingRequirementsSchema,
  readiness: z.strictObject({
    fact_claims_verified: z.boolean(),
    research_questions_sufficient: z.boolean(),
    experiment_completed: z.boolean(),
    open_gaps: z.array(z.string().max(1_000)).max(30),
  }),
  model: z.strictObject({
    provider: z.string().min(1),
    model: z.string().max(300),
    runtime_version: z.string().max(300).nullable(),
    calls: z.number().int().min(0).max(4),
    duration_ms: z.number().int().nonnegative(),
    usage: modelUsageSchema.nullable(),
  }),
  error_code: z.enum([
    'topic_input_missing', 'topic_input_invalid', 'configuration_invalid', 'source_material_invalid',
    'source_fetch_failed', 'invalid_source_quote', 'codex_not_installed', 'codex_not_authenticated',
    'codex_timeout', 'codex_rate_limited', 'codex_output_invalid', 'codex_process_failed',
    'codex_sandbox_unavailable', 'file_read_failed', 'file_write_failed',
  ]).nullable(),
  error_message_safe: z.string().max(1_000).nullable(),
  created_at: z.iso.datetime(),
}).superRefine((pack, context) => {
  if (pack.status === 'failed') {
    if (pack.decision !== null || pack.error_code === null) context.addIssue({ code: 'custom', message: 'Failed research runs require decision=null and error_code' });
  } else if (pack.decision === null || pack.error_code !== null) {
    context.addIssue({ code: 'custom', message: 'Successful research runs require a decision and no error_code' });
  }
  if (pack.decision === 'NO_TOPIC' && (pack.sources.length > 0 || pack.model.calls > 0 || pack.experiment !== null)) {
    context.addIssue({ code: 'custom', message: 'NO_TOPIC cannot fetch sources, call a model, or run an experiment' });
  }
  if (pack.decision === 'READY_FOR_WRITING' && pack.readiness.open_gaps.length > 0) {
    context.addIssue({ code: 'custom', message: 'READY_FOR_WRITING cannot contain open gaps' });
  }
});

export type ResearchIntelligenceConfig = z.infer<typeof researchIntelligenceConfigSchema>;
export type ExperimentTaskCatalog = z.infer<typeof experimentTaskCatalogSchema>;
export type ExperimentCatalogTask = z.infer<typeof experimentCatalogTaskSchema>;
export type CleanedSourceSnapshot = z.infer<typeof cleanedSourceSnapshotSchema>;
export type ResearchClaim = z.infer<typeof researchClaimSchema>;
export type ResearchAnswer = z.infer<typeof researchAnswerSchema>;
export type ResearchProviderResult = z.infer<typeof researchProviderResultSchema>;
export type ExperimentOutput = z.infer<typeof experimentOutputSchema>;
export type ExperimentResult = z.infer<typeof experimentResultSchema>;
export type ExperimentBundle = z.infer<typeof experimentBundleSchema>;
export type ResearchSourceManifest = z.infer<typeof researchSourceManifestSchema>;
export type ResearchPack = z.infer<typeof researchPackSchema>;
