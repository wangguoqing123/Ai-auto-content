import { z } from 'zod';
import { articleTypeSchema } from '../style-intelligence/schemas.js';
import { modelUsageSchema } from '../research/schemas.js';

const text = (maximum = 2_000) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum = 2_000) => z.string().max(maximum);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ruleIdSchema = z.string().regex(/^[A-Z]{3}-\d{2}$|^PLATFORM-[A-Z0-9-]+$/);
const stringList = (maximum = 50, itemMaximum = 2_000) => z.array(text(itemMaximum)).max(maximum);

export const writingDecisionSchema = z.enum([
  'READY_FOR_HUMAN_REVIEW',
  'BLOCKED_BY_RESEARCH',
  'NO_CONTENT',
  'WAITING_FOR_RESEARCH',
  'WAITING_FOR_APPROVED_STYLE',
]);

export const writingIntelligenceConfigSchema = z.strictObject({
  version: z.literal(1),
  timezone: z.literal('Asia/Shanghai'),
  writing: z.strictObject({
    maximum_codex_calls: z.literal(3),
    minimum_wechat_chinese_chars: z.number().int().min(500).max(2_400),
    maximum_wechat_chinese_chars: z.number().int().min(1_200).max(4_000),
    maximum_x_chinese_chars: z.number().int().min(100).max(280),
    prompt_version: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  }),
  source_weights: z.strictObject({
    wechat: z.strictObject({ owner: z.literal(0.65), reference: z.literal(0.2), platform: z.literal(0.15) }),
    x: z.strictObject({ owner: z.literal(1), reference: z.literal(0), platform: z.literal(0) }),
  }),
  product: z.strictObject({ price_in_public_copy: z.literal(false) }),
  schedule: z.strictObject({
    target_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    window_start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    window_end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    max_attempts: z.literal(2),
  }),
});

const profileRuleSchema = z.strictObject({
  rule_group_id: ruleIdSchema,
  display_name: text(300),
  plain_language_description: text(1_000),
  decision: z.enum(['keep', 'keep_with_scope', 'reject', 'pending', 'use', 'cautious_use', 'solution_a', 'solution_b', 'scenario_switch']),
  confidence: z.enum(['low', 'medium', 'high']),
  applicable_platforms: z.array(z.enum(['shortform_social_proxy', 'wechat'])).min(1).max(2),
  applicable_article_types: z.array(articleTypeSchema).min(1).max(5),
  scope_limit: text(1_000),
  risk_if_overused: text(1_000),
  enforcement: optionalText(1_000).optional(),
});

export const provisionalStyleProfileSchema = z.strictObject({
  artifact_schema: z.literal('ai_auto_content_provisional_style_overlay_v1'),
  artifact_type: z.literal('provisional_profile_v1'),
  provisional_profile_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,100}$/),
  display_name: text(500),
  status: z.literal('provisional_approved_with_pending_items'),
  review_status: z.literal('user_confirmed_provisional'),
  approved_at: z.iso.datetime(),
  authorization: z.strictObject({
    confirmation_phrase: text(500),
    approval_scope: z.literal('calibration_only'),
  }),
  production: z.strictObject({
    promoted: z.literal(false),
    production_compatible: z.literal(false),
    runtime_enabled: z.literal(false),
    automatic_writing_enabled: z.literal(false),
    scheduler_enabled: z.literal(false),
  }),
  source_profiles: z.strictObject({
    owner: z.strictObject({
      base_profile_id: text(100), base_status: z.literal('ready'), base_file_sha256: sha256Schema,
      base_profile_unchanged: z.literal(true), sample_count: z.number().int().min(8),
      profile_scope: z.literal('owner_shortform_social_proxy'), platform_fidelity: z.literal('proxy'),
      confidence_label: z.literal('medium'), safe_display_name: text(500),
    }),
    reference: z.strictObject({
      base_profile_id: text(100), base_status: z.literal('ready'), base_file_sha256: sha256Schema,
      base_profile_unchanged: z.literal(true), sample_count: z.number().int().min(8),
      profile_scope: z.literal('reference_wechat_technique'), confidence_label: z.literal('medium'),
      safe_display_name: text(500),
    }),
  }),
  owner_transfer_policy: z.strictObject({
    allowed: stringList(20, 100), forbidden: stringList(20, 100), approved_rules: z.array(profileRuleSchema).min(1).max(30),
  }),
  reference_transfer_policy: z.strictObject({
    allowed: stringList(20, 100), forbidden: stringList(20, 100),
    protected_index_status: z.literal('ready'), fail_closed: z.literal(true),
    approved_rules: z.array(profileRuleSchema).min(1).max(30),
  }),
  conflict_policies: z.array(profileRuleSchema).min(1).max(30),
  blind_review_adjustments: z.strictObject({
    short_content: z.strictObject({
      directness_target: z.number().int().min(1).max(5), current_naturalness_feedback: z.number().int().min(1).max(5),
      avoid_coaching_opener: z.boolean(), voice_implementation_requires_revision: z.boolean(),
    }),
    wechat_longform: z.strictObject({
      owner_natural_expression_priority: z.boolean(), reference_structure_secondary: z.boolean(),
      avoid_fragmented_paragraphs: z.boolean(), avoid_over_regular_structure: z.boolean(),
    }),
  }),
  safe_defaults_for_pending_items: z.record(z.string(), text(1_000)),
  counts: z.strictObject({
    owner_keep: z.number().int().nonnegative(), owner_keep_with_scope: z.number().int().nonnegative(),
    owner_reject: z.number().int().nonnegative(), owner_pending: z.number().int().nonnegative(),
    reference_use: z.number().int().nonnegative(), reference_cautious_use: z.number().int().nonnegative(),
    conflict_active: z.number().int().nonnegative(), conflict_pending: z.number().int().nonnegative(),
    finalized_manual_decisions: z.number().int().nonnegative(), unresolved_manual_items: z.number().int().nonnegative(),
  }),
});

const receiptBody = {
  status: z.literal('recorded'),
  recorded_at: z.iso.datetime(),
  authorization_phrase_sha256: sha256Schema,
  input_evidence: z.strictObject({
    approval_form_sha256: sha256Schema, approval_candidates_sha256: sha256Schema,
    owner_base_profile_sha256: sha256Schema, reference_base_profile_sha256: sha256Schema,
    protected_index_sha256: sha256Schema,
  }),
  normalized_decisions: z.strictObject({
    owner: z.strictObject({ keep: z.array(ruleIdSchema), keep_with_scope: z.array(ruleIdSchema), reject: z.array(ruleIdSchema), pending: z.array(ruleIdSchema) }),
    reference: z.strictObject({ use: z.array(ruleIdSchema), cautious_use: z.array(ruleIdSchema), reject: z.array(ruleIdSchema) }),
    conflicts: z.record(ruleIdSchema, z.enum(['solution_a', 'solution_b', 'scenario_switch', 'pending'])),
    blind_feedback: z.strictObject({
      short_most_like: text(10), short_least_like: text(10), directness: z.number().int(), naturalness: z.number().int(),
      tutorial_like: text(30), wechat_most_readable: text(10), wechat_most_like_owner: text(10),
      wechat_least_like_owner: text(10), too_fragmented: z.boolean(), too_regular: z.boolean(), reference_similarity: text(30),
    }),
  }),
  blind_mapping_copied: z.literal(false), protected_text_copied: z.literal(false), production_modified: z.literal(false),
} as const;

export const styleApprovalReceiptSchema = z.discriminatedUnion('version', [
  z.strictObject({ version: z.literal(1), ...receiptBody }),
  z.strictObject({ version: z.literal(2), provisional_profile_sha256: sha256Schema, ...receiptBody }),
]);

export const approvalBindingAttestationSchema = z.strictObject({
  version: z.literal(1), type: z.literal('legacy_receipt_profile_binding'), hash_algorithm: z.literal('sha256'),
  source_receipt: z.strictObject({ filename: z.literal('approval-receipt.json'), sha256: sha256Schema }),
  provisional_profile: z.strictObject({ filename: z.literal('provisional-profile-v1.json'), sha256: sha256Schema, status: z.literal('provisional_approved_with_pending_items') }),
  approval_summary: z.strictObject({ filename: z.literal('provisional-approval-summary.md'), sha256: sha256Schema }),
  decision_set_sha256: sha256Schema,
  decision_count: z.number().int().positive(),
  decision_set_canonicalization: z.strictObject({
    source: z.literal('provisional-profile-v1.json'), inclusion: z.literal('finalized_decisions_only_excluding_pending'),
    sort: z.literal('rule_id_ascending'), fields: z.tuple([z.literal('rule_id'), z.literal('decision'), z.literal('scope'), z.literal('status')]),
    object_key_order: z.literal('lexicographic'), serialization: z.literal('compact_json'), encoding: z.literal('utf-8'),
    status_mapping: z.literal('reject_is_deleted; all_other_finalized_decisions_are_active'),
  }),
  closed_rule_ids: z.array(ruleIdSchema), deleted_rule_ids: z.array(ruleIdSchema),
  owner_profile_hashes: z.array(z.strictObject({ filename: text(300), sha256: sha256Schema })).min(1),
  reference_profile_hashes: z.array(z.strictObject({ filename: text(300), sha256: sha256Schema })).min(1),
  semantic_changes: z.literal(false), user_reapproval_required: z.literal(false),
  migration_reason: text(1_000), created_at: z.iso.datetime(),
});

export const resolvedStyleRuleSchema = z.strictObject({
  rule_id: ruleIdSchema,
  source_role: z.enum(['owner', 'reference', 'conflict', 'platform']),
  source_profile_id: z.string().nullable(),
  category: z.enum(['voice', 'judgment', 'explanation', 'uncertainty', 'first_person', 'rhythm', 'lexical', 'structure', 'evidence', 'cta', 'constraint']),
  text: text(1_000),
  decision: text(100),
  scope: text(1_000),
  applicable_platforms: z.array(z.enum(['shortform_social_proxy', 'wechat'])).min(1),
  applicable_article_types: z.array(articleTypeSchema).min(1),
  confidence: z.enum(['low', 'medium', 'high']),
});

export const resolvedWritingStyleSchema = z.strictObject({
  style_status: z.enum(['provisional_approved_with_pending_items', 'approved']),
  approval_chain_status: z.enum(['valid_v2_receipt', 'valid_legacy_receipt_with_binding_attestation']),
  production_eligible: z.boolean(),
  profile_ids: z.strictObject({ owner: z.string(), reference: z.string(), provisional: z.string() }),
  profile_versions: z.strictObject({ provisional: z.literal(1) }),
  profile_hashes: z.strictObject({ owner: sha256Schema, reference: sha256Schema, provisional: sha256Schema }),
  receipt_hash: sha256Schema,
  attestation_hash: sha256Schema.nullable(),
  decision_set_hash: sha256Schema,
  active_rules: z.array(resolvedStyleRuleSchema).max(100),
  scoped_rules: z.array(resolvedStyleRuleSchema).max(100),
  excluded_rule_ids: z.array(ruleIdSchema),
  deleted_rule_ids: z.array(ruleIdSchema),
  style_scope: z.literal('owner_shortform_social_proxy'),
  platform_fidelity: z.literal('proxy'),
  known_gaps: stringList(20, 500),
  confidence_label: z.literal('medium'),
});

export const contentBlockSchema = z.strictObject({
  block_id: z.string().regex(/^block_[a-z0-9_-]{1,60}$/),
  block_type: z.enum(['hook', 'problem', 'analysis', 'step', 'example', 'evidence', 'acceptance', 'failure', 'boundary', 'cta']),
  text: text(6_000),
  claim_ids: z.array(z.string().regex(/^claim_[a-z0-9_-]{1,60}$/)).max(8),
  experiment_refs: z.array(z.enum(['baseline_chat_request', 'structured_task_card'])).max(2),
  product_claim_ids: z.array(z.string().max(200)).max(10),
  persona_fact_ids: z.array(z.string().max(200)).max(10),
  style_rule_ids: z.array(ruleIdSchema).max(20),
  is_opinion: z.boolean(),
});

export const visualSlotSchema = z.strictObject({
  slot_id: z.string().regex(/^visual_[a-z0-9_-]{1,60}$/), location: text(500), purpose: text(1_000),
  visual_type: z.enum(['cover', 'process_diagram', 'checklist', 'comparison', 'screenshot', 'result_card']),
  required_evidence_refs: z.array(text(200)).max(20), caption: text(1_000), generation_status: z.literal('not_started'),
});

export const masterDraftSchema = z.strictObject({
  article_type: articleTypeSchema,
  blocks: z.array(contentBlockSchema).min(1).max(30),
  rendered_markdown: text(50_000),
});

export const wechatDraftSchema = z.strictObject({
  primary_title: text(100),
  alternative_titles: z.tuple([text(100), text(100)]),
  abstract: text(500),
  article_type: articleTypeSchema,
  blocks: z.array(contentBlockSchema).min(1).max(30),
  article_markdown: text(50_000),
  chinese_character_count: z.number().int().min(0),
  source_notes: z.array(z.strictObject({ title: text(500), url: z.url().nullable(), support_status: z.enum(['direct', 'partial']), scope_limit: optionalText(1_000) })).max(8),
  cta: z.strictObject({ mode: z.enum(['none', 'light']), text: optionalText(1_000) }),
  visual_slots: z.array(visualSlotSchema).max(10),
});

export const xDraftSchema = z.strictObject({
  format: z.enum(['single_post', 'thread', 'debate_prompt']),
  single_post: optionalText(500).nullable(),
  thread: z.array(text(500)).max(7),
  debate_prompt: optionalText(500).nullable(),
}).superRefine((draft, context) => {
  if (draft.format === 'single_post' && (draft.single_post === null || draft.thread.length > 0 || draft.debate_prompt !== null)) context.addIssue({ code: 'custom', message: 'single_post must be the only X output' });
  if (draft.format === 'thread' && (draft.single_post !== null || draft.thread.length < 4 || draft.debate_prompt !== null)) context.addIssue({ code: 'custom', message: 'thread must contain 4-7 posts and be the only X output' });
  if (draft.format === 'debate_prompt' && (draft.single_post !== null || draft.thread.length > 0 || draft.debate_prompt === null)) context.addIssue({ code: 'custom', message: 'debate_prompt must be the only X output' });
});

export const writingIssueSchema = z.strictObject({
  issue_code: text(100), severity: z.enum(['hard_blocker', 'blocking_style_issue', 'warning', 'profile_preference']),
  location: text(300), quoted_text: optionalText(1_000), repair_constraint: text(1_000),
});

const auditSchema = z.strictObject({
  status: z.enum(['pass', 'blocked']),
  issues: z.array(writingIssueSchema).max(100),
  checked_items: stringList(100, 1_000),
});

export const writingAuditSchema = z.strictObject({
  evidence: auditSchema.extend({ required_claim_ids: z.array(z.string()), used_claim_ids: z.array(z.string()) }),
  experiment: auditSchema,
  product: auditSchema.extend({ requested_cta_mode: z.enum(['none', 'light', 'club']).nullable(), effective_cta_mode: z.enum(['none', 'light']) }),
  first_person: auditSchema.extend({ sentences: z.array(z.strictObject({ sentence: text(1_000), type: z.enum(['opinion', 'factual']), evidence_refs: z.array(z.string()), allowed: z.boolean() })).max(100) }),
  style: auditSchema,
  plagiarism: auditSchema.extend({ protected_transfer_detected: z.boolean(), reference_overlap_detected: z.boolean() }),
  unknowns: stringList(100, 2_000),
  quality_issues: z.array(writingIssueSchema).max(100),
});

export const writingPackSchema = z.strictObject({
  version: z.literal(1),
  writing_date: z.iso.date(),
  run_id: z.string().regex(/^writing_[0-9T_-]+Z$/),
  status: z.enum(['success', 'failed']),
  decision: writingDecisionSchema.nullable(),
  input_hash: sha256Schema,
  synthetic_fixture: z.boolean(),
  not_for_publication: z.boolean(),
  research: z.strictObject({
    research_run_id: z.string().nullable(), research_input_hash: sha256Schema.nullable(),
    research_decision: z.enum(['READY_FOR_WRITING', 'RESEARCH_INCOMPLETE', 'NO_TOPIC']).nullable(), topic_signature: sha256Schema.nullable(),
  }),
  style: z.strictObject({
    style_status: z.enum(['provisional_approved_with_pending_items', 'approved']),
    approval_chain_status: z.enum(['valid_v2_receipt', 'valid_legacy_receipt_with_binding_attestation']),
    provisional_style_used: z.boolean(), production_eligible: z.boolean(),
    profile_ids: z.strictObject({ owner: z.string(), reference: z.string(), provisional: z.string() }),
    profile_versions: z.strictObject({ provisional: z.literal(1) }),
    profile_hashes: z.strictObject({ owner: sha256Schema, reference: sha256Schema, provisional: sha256Schema }),
    receipt_sha256: sha256Schema, attestation_sha256: sha256Schema.nullable(), decision_set_sha256: sha256Schema,
    recipe_hash: sha256Schema, selected_rule_ids: z.array(ruleIdSchema), excluded_rule_ids: z.array(ruleIdSchema), deleted_rule_ids: z.array(ruleIdSchema),
    owner_profile_scope: z.literal('owner_shortform_social_proxy'), platform_fidelity: z.literal('proxy'), confidence: z.literal('medium'),
  }).nullable(),
  master_draft: masterDraftSchema.nullable(),
  wechat: wechatDraftSchema.nullable(),
  x: xDraftSchema.nullable(),
  audits: writingAuditSchema.nullable(),
  human_gate: z.strictObject({ required: z.literal(true), status: z.literal('unreviewed'), automated_publish_allowed: z.literal(false) }),
  model: z.strictObject({
    provider: z.string().min(1), model: z.string().max(300), runtime_version: z.string().max(300).nullable(),
    calls: z.number().int().min(0).max(3), duration_ms: z.number().int().nonnegative(), usage: modelUsageSchema.nullable(),
  }),
  error_code: z.enum([
    'style_approval_chain_invalid', 'protected_transfer_detected', 'reference_overlap_detected',
    'writing_audit_failed', 'writing_output_invalid', 'configuration_invalid', 'file_read_failed', 'file_write_failed',
    'codex_not_installed', 'codex_not_authenticated', 'codex_non_interactive_unavailable', 'codex_timeout',
    'codex_rate_limited', 'codex_output_invalid', 'codex_process_failed', 'codex_sandbox_unavailable',
  ]).nullable(),
  error_message_safe: z.string().max(1_000).nullable(),
  created_at: z.iso.datetime(),
}).superRefine((pack, context) => {
  const contentPresent = pack.master_draft !== null && pack.wechat !== null && pack.x !== null && pack.audits !== null;
  if (pack.status === 'failed') {
    if (pack.decision !== null || pack.error_code === null) context.addIssue({ code: 'custom', message: 'Failed runs require decision=null and error_code' });
  } else if (pack.decision === null || pack.error_code !== null) context.addIssue({ code: 'custom', message: 'Successful runs require decision and no error_code' });
  if (pack.decision === 'READY_FOR_HUMAN_REVIEW' && (!contentPresent || pack.style === null)) context.addIssue({ code: 'custom', message: 'READY_FOR_HUMAN_REVIEW requires all content and audits' });
  if (pack.decision !== 'READY_FOR_HUMAN_REVIEW' && contentPresent) context.addIssue({ code: 'custom', message: 'Non-ready decisions cannot contain content' });
  if (pack.style?.provisional_style_used === true && pack.style.production_eligible) context.addIssue({ code: 'custom', message: 'Provisional style cannot be production eligible' });
});

export const writerOutputSchema = z.strictObject({
  article_type: articleTypeSchema,
  primary_title: text(100),
  alternative_titles: z.array(text(100)).length(2),
  abstract: text(500),
  blocks: z.array(contentBlockSchema).min(6).max(24),
  source_notes: z.array(z.strictObject({ claim_id: z.string() })).max(8),
  cta: z.strictObject({ mode: z.enum(['none', 'light']), text: optionalText(1_000) }),
  visual_slots: z.array(visualSlotSchema).max(10),
  x: xDraftSchema,
});

export const reviewerOutputSchema = z.strictObject({
  issues: z.array(writingIssueSchema).max(30),
});

export const repairOutputSchema = z.strictObject({
  repaired_blocks: z.array(z.strictObject({ block_id: z.string(), text: text(6_000) })).max(24),
});

export type WritingIntelligenceConfig = z.infer<typeof writingIntelligenceConfigSchema>;
export type ProvisionalStyleProfile = z.infer<typeof provisionalStyleProfileSchema>;
export type StyleApprovalReceipt = z.infer<typeof styleApprovalReceiptSchema>;
export type ApprovalBindingAttestation = z.infer<typeof approvalBindingAttestationSchema>;
export type ResolvedWritingStyleSnapshot = z.infer<typeof resolvedWritingStyleSchema>;
export type ResolvedStyleRule = z.infer<typeof resolvedStyleRuleSchema>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type MasterDraft = z.infer<typeof masterDraftSchema>;
export type WechatDraft = z.infer<typeof wechatDraftSchema>;
export type XDraft = z.infer<typeof xDraftSchema>;
export type WritingAudit = z.infer<typeof writingAuditSchema>;
export type WritingPack = z.infer<typeof writingPackSchema>;
export type WriterOutput = z.infer<typeof writerOutputSchema>;
export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;
export type RepairOutput = z.infer<typeof repairOutputSchema>;
