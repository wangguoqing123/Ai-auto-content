import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSyntheticReadyResearchPack } from '../src/writing/fixture.js';
import { sha256 } from '../src/style-intelligence/hash.js';
import type { ApprovalHashExpectations } from '../src/writing/style-approval-resolver.js';

type ExpectedHashes = ApprovalHashExpectations;

export interface StyleChainFixture {
  root: string;
  calibrationRoot: string;
  provisionalDirectory: string;
  profile: string;
  receipt: string;
  attestation: string;
  summary: string;
  hashes: ExpectedHashes;
  cleanup(): Promise<void>;
}

const ownerKeep = ['OCV-01', 'OCV-02', 'OCV-03', 'OCV-04', 'OCV-05', 'OCV-07', 'OCV-08', 'OSL-01', 'OSL-02', 'OSL-03', 'OSL-04', 'OSL-05'];
const referenceUse = ['RFT-01', 'RFT-02', 'RFT-03', 'RFT-04', 'RFT-06', 'RFT-07'];
const conflictDecisions = { 'CON-01': 'solution_a', 'CON-02': 'scenario_switch', 'CON-03': 'solution_a', 'CON-04': 'scenario_switch', 'CON-05': 'pending', 'CON-06': 'scenario_switch', 'CON-07': 'scenario_switch', 'CON-08': 'solution_b' } as const;

function rule(rule_group_id: string, decision: string, source: 'owner' | 'reference' | 'conflict') {
  const applicable = rule_group_id === 'OCV-06' ? ['opinion', 'analysis', 'tutorial']
    : source === 'reference' ? ['tutorial', 'analysis', 'case_breakdown'] : ['tutorial', 'analysis', 'opinion'];
  return {
    rule_group_id, display_name: `Synthetic ${rule_group_id}`, plain_language_description: `Synthetic approved behavior for ${rule_group_id}.`, decision,
    confidence: 'medium', applicable_platforms: source === 'reference' ? ['wechat'] : ['shortform_social_proxy', 'wechat'],
    applicable_article_types: applicable, scope_limit: `Synthetic scope for ${rule_group_id}.`, risk_if_overused: `Synthetic risk for ${rule_group_id}.`,
    ...(['OCV-06', 'OCV-09', 'OCV-10', 'RFT-05', 'CON-05'].includes(rule_group_id) ? { enforcement: `Synthetic enforcement for ${rule_group_id}.` } : {}),
  };
}

function syntheticProfile() {
  return {
    artifact_schema: 'ai_auto_content_provisional_style_overlay_v1', artifact_type: 'provisional_profile_v1',
    provisional_profile_id: 'synthetic-style-provisional-v1', display_name: 'Synthetic provisional profile', status: 'provisional_approved_with_pending_items',
    review_status: 'user_confirmed_provisional', approved_at: '2026-08-17T04:05:38.263Z',
    authorization: { confirmation_phrase: 'Synthetic fixture confirmation.', approval_scope: 'calibration_only' },
    production: { promoted: false, production_compatible: false, runtime_enabled: false, automatic_writing_enabled: false, scheduler_enabled: false },
    source_profiles: {
      owner: { base_profile_id: 'synthetic-owner-v1', base_status: 'ready', base_file_sha256: 'a'.repeat(64), base_profile_unchanged: true, sample_count: 9, profile_scope: 'owner_shortform_social_proxy', platform_fidelity: 'proxy', confidence_label: 'medium', safe_display_name: 'Synthetic owner' },
      reference: { base_profile_id: 'synthetic-reference-v1', base_status: 'ready', base_file_sha256: 'b'.repeat(64), base_profile_unchanged: true, sample_count: 10, profile_scope: 'reference_wechat_technique', confidence_label: 'medium', safe_display_name: 'Synthetic reference' },
    },
    owner_transfer_policy: {
      allowed: ['voice', 'judgment', 'explanation_tendency', 'uncertainty', 'first_person_tendency', 'rhythm_preference', 'limited_lexical_preference'],
      forbidden: ['native_x_interaction_style', 'x_thread_structure', 'x_reply_behavior', 'wechat_longform_structure', 'wechat_paragraph_length', 'longform_section_order', 'wechat_cta_length'],
      approved_rules: [...ownerKeep.map((id) => rule(id, 'keep', 'owner')), rule('OCV-06', 'keep_with_scope', 'owner'), rule('OCV-10', 'reject', 'owner'), rule('OCV-09', 'pending', 'owner')],
    },
    reference_transfer_policy: {
      allowed: ['structure_technique', 'explanation_technique', 'evidence_placement', 'paragraph_progression', 'cta_technique', 'free_value_completeness'],
      forbidden: ['voice', 'preferred_terms', 'personal_identity', 'personal_experience', 'signature_phrase', 'unique_metaphor', 'factual_claim', 'client_or_student_story'],
      protected_index_status: 'ready', fail_closed: true,
      approved_rules: [...referenceUse.map((id) => rule(id, 'use', 'reference')), rule('RFT-05', 'cautious_use', 'reference')],
    },
    conflict_policies: Object.entries(conflictDecisions).map(([id, decision]) => rule(id, decision, 'conflict')),
    blind_review_adjustments: {
      short_content: { directness_target: 4, current_naturalness_feedback: 2, avoid_coaching_opener: true, voice_implementation_requires_revision: true },
      wechat_longform: { owner_natural_expression_priority: true, reference_structure_secondary: true, avoid_fragmented_paragraphs: true, avoid_over_regular_structure: true },
    },
    safe_defaults_for_pending_items: { 'OCV-09': 'disabled', 'CON-05': 'disabled' },
    counts: { owner_keep: 12, owner_keep_with_scope: 1, owner_reject: 1, owner_pending: 1, reference_use: 6, reference_cautious_use: 1, conflict_active: 7, conflict_pending: 1, finalized_manual_decisions: 28, unresolved_manual_items: 2 },
  };
}

function decisionHash(profile: ReturnType<typeof syntheticProfile>): string {
  const all = [...profile.owner_transfer_policy.approved_rules, ...profile.reference_transfer_policy.approved_rules, ...profile.conflict_policies];
  const decisions = all.filter(({ decision }) => decision !== 'pending').map(({ rule_group_id, decision, scope_limit }) => ({ decision, rule_id: rule_group_id, scope: scope_limit, status: decision === 'reject' ? 'deleted' : 'active' })).sort((left, right) => left.rule_id.localeCompare(right.rule_id));
  return sha256(JSON.stringify(decisions));
}

function serialize(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }

export async function createStyleChainFixture(): Promise<StyleChainFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writing-style-chain-'));
  const calibrationRoot = path.join(root, 'calibration');
  const provisionalDirectory = path.join(calibrationRoot, 'cache', 'review-v2', 'provisional');
  await mkdir(provisionalDirectory, { recursive: true, mode: 0o700 });
  const profileValue = syntheticProfile();
  const profileRaw = serialize(profileValue);
  const summaryRaw = '# Synthetic Provisional Approval Summary\n\nFixture only.\n';
  const receiptValue = {
    version: 1, status: 'recorded', recorded_at: '2026-08-17T04:05:38.263Z', authorization_phrase_sha256: 'c'.repeat(64),
    input_evidence: { approval_form_sha256: 'd'.repeat(64), approval_candidates_sha256: 'e'.repeat(64), owner_base_profile_sha256: 'a'.repeat(64), reference_base_profile_sha256: 'b'.repeat(64), protected_index_sha256: 'f'.repeat(64) },
    normalized_decisions: {
      owner: { keep: ownerKeep, keep_with_scope: ['OCV-06'], reject: ['OCV-10'], pending: ['OCV-09'] },
      reference: { use: referenceUse, cautious_use: ['RFT-05'], reject: [] }, conflicts: conflictDecisions,
      blind_feedback: { short_most_like: 'B', short_least_like: 'C', directness: 4, naturalness: 2, tutorial_like: 'neutral', wechat_most_readable: 'C', wechat_most_like_owner: 'C', wechat_least_like_owner: 'A', too_fragmented: true, too_regular: true, reference_similarity: 'neutral' },
    },
    blind_mapping_copied: false, protected_text_copied: false, production_modified: false,
  };
  const receiptRaw = serialize(receiptValue);
  const hashes: ExpectedHashes = { receipt: sha256(receiptRaw), provisionalProfile: sha256(profileRaw), summary: sha256(summaryRaw), decisionSet: decisionHash(profileValue) };
  const attestationValue = {
    version: 1, type: 'legacy_receipt_profile_binding', hash_algorithm: 'sha256',
    source_receipt: { filename: 'approval-receipt.json', sha256: hashes.receipt },
    provisional_profile: { filename: 'provisional-profile-v1.json', sha256: hashes.provisionalProfile, status: 'provisional_approved_with_pending_items' },
    approval_summary: { filename: 'provisional-approval-summary.md', sha256: hashes.summary }, decision_set_sha256: hashes.decisionSet, decision_count: 28,
    decision_set_canonicalization: { source: 'provisional-profile-v1.json', inclusion: 'finalized_decisions_only_excluding_pending', sort: 'rule_id_ascending', fields: ['rule_id', 'decision', 'scope', 'status'], object_key_order: 'lexicographic', serialization: 'compact_json', encoding: 'utf-8', status_mapping: 'reject_is_deleted; all_other_finalized_decisions_are_active' },
    closed_rule_ids: ['CON-05', 'OCV-09'], deleted_rule_ids: ['OCV-10'],
    owner_profile_hashes: [{ filename: 'synthetic-owner-v1.profile.v1.json', sha256: 'a'.repeat(64) }], reference_profile_hashes: [{ filename: 'synthetic-reference-v1.profile.v1.json', sha256: 'b'.repeat(64) }],
    semantic_changes: false, user_reapproval_required: false, migration_reason: 'synthetic legacy binding fixture', created_at: '2026-08-17T15:48:18Z',
  };
  const files = {
    profile: path.join(provisionalDirectory, 'provisional-profile-v1.json'), receipt: path.join(provisionalDirectory, 'approval-receipt.json'),
    attestation: path.join(provisionalDirectory, 'approval-binding-attestation.v1.json'), summary: path.join(provisionalDirectory, 'provisional-approval-summary.md'),
  };
  await Promise.all([
    writeFile(files.profile, profileRaw, { mode: 0o600 }), writeFile(files.receipt, receiptRaw, { mode: 0o600 }),
    writeFile(files.attestation, serialize(attestationValue), { mode: 0o600 }), writeFile(files.summary, summaryRaw, { mode: 0o600 }),
  ]);
  return { root, calibrationRoot, provisionalDirectory, ...files, hashes, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export async function readJson(filename: string): Promise<Record<string, any>> { return JSON.parse(await readFile(filename, 'utf8')) as Record<string, any>; }
export async function writePrivateJson(filename: string, value: unknown): Promise<void> { await writeFile(filename, serialize(value), { mode: 0o600 }); await chmod(filename, 0o600); }

export async function createReadyRepository(): Promise<{ root: string; cleanup(): Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writing-ready-repo-'));
  const directory = path.join(root, 'data', 'research-packs', '2026-08-14');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'research-pack.json'), serialize(buildSyntheticReadyResearchPack()));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await copyFile(path.join(process.cwd(), 'config', 'writing-intelligence.yaml'), path.join(root, 'config', 'writing-intelligence.yaml'));
  await copyFile(path.join(process.cwd(), 'config', 'product.yaml'), path.join(root, 'config', 'product.yaml'));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
