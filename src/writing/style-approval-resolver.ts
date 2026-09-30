import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkComponents, assertResolvedPathOutsideRepository } from '../style-intelligence/safe-local-path.js';
import { stableJson } from '../style-intelligence/hash.js';
import {
  approvalBindingAttestationSchema,
  provisionalStyleProfileSchema,
  resolvedWritingStyleSchema,
  styleApprovalReceiptSchema,
  type ApprovalBindingAttestation,
  type ProvisionalStyleProfile,
  type ResolvedStyleRule,
  type ResolvedWritingStyleSnapshot,
  type StyleApprovalReceipt,
} from './schemas.js';

export interface ApprovalHashExpectations { receipt: string; provisionalProfile: string; summary: string; decisionSet: string }

export const currentApprovalHashes: Readonly<ApprovalHashExpectations> = Object.freeze({
  receipt: '4c2cf6a1ac8d5e23c36cca3c02993b7bbd7738f49d9db1eef113bcff76f6a1e1',
  provisionalProfile: '38ee0a53d37ab56b94e0651418755536630743f2be8b77f14396428beb647ee4',
  summary: '382fd8f18adbaed75d1b159f5496037035a8fd6d42f36782bbf5e0ba0b337e7f',
  decisionSet: '6bafa8b40be7e6753f9191b3bf5fa35801f65c2e62671a1706ca02e338b86678',
});

export interface ResolvedWritingStyle { readonly kind: 'resolved_writing_style' }
const resolvedStyles = new WeakMap<object, Readonly<ResolvedWritingStyleSnapshot>>();

export class StyleApprovalChainError extends Error {
  readonly code = 'style_approval_chain_invalid';
  constructor(readonly reason: string) { super('style_approval_chain_invalid'); this.name = 'StyleApprovalChainError'; }
}

export interface ResolveStyleApprovalOptions {
  repositoryRoot: string;
  researchGateAllowed: true;
  styleProfilePath: string;
  approvalReceiptPath: string;
  bindingAttestationPath?: string;
  expectedHashes?: Readonly<ApprovalHashExpectations> | null;
}

function fail(reason: string): never { throw new StyleApprovalChainError(reason); }
function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function sorted(values: readonly string[]): string[] { return [...values].sort((left, right) => left.localeCompare(right)); }
function sameSet(left: readonly string[], right: readonly string[]): boolean { return stableJson(sorted(left)) === stableJson(sorted(right)); }

async function readPrivateStyleFile(filename: string, calibrationRoot: string, repositoryRoot: string): Promise<{ raw: string; hash: string }> {
  const absolute = path.resolve(filename);
  const root = await realpath(calibrationRoot);
  await assertNoSymlinkComponents(absolute);
  const canonical = await realpath(absolute);
  const relative = path.relative(root, canonical);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('style_file_outside_calibration_root');
  await assertResolvedPathOutsideRepository(canonical, repositoryRoot);
  const info = await lstat(absolute);
  if (info.isSymbolicLink()) fail('style_file_symlink_not_allowed');
  if (!info.isFile()) fail('style_file_must_be_regular');
  if ((info.mode & 0o777) !== 0o600) fail('style_file_insecure_permissions');
  const handle = await open(absolute, 'r');
  try {
    const checked = await handle.stat();
    if (!checked.isFile() || (checked.mode & 0o777) !== 0o600) fail('style_file_changed_during_read');
    const buffer = await handle.readFile();
    return { raw: buffer.toString('utf8'), hash: sha256(buffer) };
  } finally { await handle.close(); }
}

function safeJson<T>(raw: string, parse: (value: unknown) => T): T {
  try { return parse(JSON.parse(raw) as unknown); } catch { return fail('style_json_invalid'); }
}

type ProfileRule = ProvisionalStyleProfile['owner_transfer_policy']['approved_rules'][number];

function allRules(profile: ProvisionalStyleProfile): Array<ProfileRule & { sourceRole: 'owner' | 'reference' | 'conflict' }> {
  return [
    ...profile.owner_transfer_policy.approved_rules.map((rule) => ({ ...rule, sourceRole: 'owner' as const })),
    ...profile.reference_transfer_policy.approved_rules.map((rule) => ({ ...rule, sourceRole: 'reference' as const })),
    ...profile.conflict_policies.map((rule) => ({ ...rule, sourceRole: 'conflict' as const })),
  ];
}

function canonicalDecisionSet(profile: ProvisionalStyleProfile) {
  return allRules(profile)
    .filter(({ decision }) => decision !== 'pending')
    .map(({ rule_group_id, decision, scope_limit }) => ({
      decision,
      rule_id: rule_group_id,
      scope: scope_limit,
      status: decision === 'reject' ? 'deleted' as const : 'active' as const,
    }))
    .sort((left, right) => left.rule_id.localeCompare(right.rule_id));
}

function categoryFor(ruleId: string): ResolvedStyleRule['category'] {
  const categories: Record<string, ResolvedStyleRule['category']> = {
    'OCV-01': 'voice', 'OCV-02': 'judgment', 'OCV-03': 'first_person', 'OCV-04': 'explanation',
    'OCV-05': 'judgment', 'OCV-06': 'uncertainty', 'OCV-07': 'rhythm', 'OCV-08': 'judgment',
    'OSL-01': 'voice', 'OSL-02': 'rhythm', 'OSL-03': 'first_person', 'OSL-04': 'cta', 'OSL-05': 'voice',
    'RFT-01': 'structure', 'RFT-02': 'structure', 'RFT-03': 'explanation', 'RFT-04': 'evidence',
    'RFT-05': 'constraint', 'RFT-06': 'explanation', 'RFT-07': 'cta',
    'CON-01': 'judgment', 'CON-02': 'rhythm', 'CON-03': 'first_person', 'CON-04': 'structure',
    'CON-06': 'structure', 'CON-07': 'voice', 'CON-08': 'constraint',
  };
  return categories[ruleId] ?? 'constraint';
}

function normalizedReceiptSets(receipt: StyleApprovalReceipt) {
  return {
    ownerKeep: receipt.normalized_decisions.owner.keep,
    ownerScoped: receipt.normalized_decisions.owner.keep_with_scope,
    ownerRejected: receipt.normalized_decisions.owner.reject,
    ownerPending: receipt.normalized_decisions.owner.pending,
    referenceUse: receipt.normalized_decisions.reference.use,
    referenceScoped: receipt.normalized_decisions.reference.cautious_use,
    referenceRejected: receipt.normalized_decisions.reference.reject,
    conflictsActive: Object.entries(receipt.normalized_decisions.conflicts).filter(([, decision]) => decision !== 'pending').map(([id]) => id),
    conflictsPending: Object.entries(receipt.normalized_decisions.conflicts).filter(([, decision]) => decision === 'pending').map(([id]) => id),
  };
}

function validateDecisions(profile: ProvisionalStyleProfile, receipt: StyleApprovalReceipt): void {
  const sets = normalizedReceiptSets(receipt);
  const owner = profile.owner_transfer_policy.approved_rules;
  const reference = profile.reference_transfer_policy.approved_rules;
  const conflicts = profile.conflict_policies;
  const ids = (rules: readonly ProfileRule[], decisions: readonly ProfileRule['decision'][]) => rules.filter(({ decision }) => decisions.includes(decision)).map(({ rule_group_id }) => rule_group_id);
  if (!sameSet(ids(owner, ['keep']), sets.ownerKeep)) fail('owner_keep_decisions_mismatch');
  if (!sameSet(ids(owner, ['keep_with_scope']), sets.ownerScoped)) fail('owner_scoped_decisions_mismatch');
  if (!sameSet(ids(owner, ['reject']), sets.ownerRejected)) fail('owner_reject_decisions_mismatch');
  if (!sameSet(ids(owner, ['pending']), sets.ownerPending)) fail('owner_pending_decisions_mismatch');
  if (!sameSet(ids(reference, ['use']), sets.referenceUse)) fail('reference_use_decisions_mismatch');
  if (!sameSet(ids(reference, ['cautious_use']), sets.referenceScoped)) fail('reference_scoped_decisions_mismatch');
  if (!sameSet(ids(reference, ['reject']), sets.referenceRejected)) fail('reference_reject_decisions_mismatch');
  if (!sameSet(ids(conflicts, ['solution_a', 'solution_b', 'scenario_switch']), sets.conflictsActive)) fail('conflict_active_decisions_mismatch');
  if (!sameSet(ids(conflicts, ['pending']), sets.conflictsPending)) fail('conflict_pending_decisions_mismatch');
}

function resolvedRule(rule: ReturnType<typeof allRules>[number], profile: ProvisionalStyleProfile): ResolvedStyleRule {
  return {
    rule_id: rule.rule_group_id,
    source_role: rule.sourceRole,
    source_profile_id: rule.sourceRole === 'owner' ? profile.source_profiles.owner.base_profile_id
      : rule.sourceRole === 'reference' ? profile.source_profiles.reference.base_profile_id : null,
    category: categoryFor(rule.rule_group_id),
    text: rule.plain_language_description,
    decision: rule.decision,
    scope: rule.scope_limit,
    applicable_platforms: rule.applicable_platforms,
    applicable_article_types: rule.applicable_article_types,
    confidence: rule.confidence,
  };
}

function makeResolved(snapshot: ResolvedWritingStyleSnapshot): ResolvedWritingStyle {
  const value = Object.freeze({ kind: 'resolved_writing_style' as const });
  resolvedStyles.set(value, Object.freeze(resolvedWritingStyleSchema.parse(snapshot)));
  return value;
}

export function resolvedWritingStyleSnapshot(value: ResolvedWritingStyle): ResolvedWritingStyleSnapshot {
  if (value === null || typeof value !== 'object') fail('unresolved_style_object');
  const snapshot = resolvedStyles.get(value);
  if (snapshot === undefined) fail('unresolved_style_object');
  return resolvedWritingStyleSchema.parse(snapshot);
}

export function rulesForWriter(value: ResolvedWritingStyle, platform: 'wechat' | 'x', articleType: ResolvedStyleRule['applicable_article_types'][number]): ResolvedStyleRule[] {
  const snapshot = resolvedWritingStyleSnapshot(value);
  const platformScope = platform === 'wechat' ? 'wechat' : 'shortform_social_proxy';
  return snapshot.active_rules.filter((rule) => rule.applicable_platforms.includes(platformScope) && rule.applicable_article_types.includes(articleType));
}

export async function resolveStyleApprovalChain(options: ResolveStyleApprovalOptions): Promise<ResolvedWritingStyle> {
  if (options.researchGateAllowed !== true) fail('research_gate_must_run_first');
  const provisionalDirectory = path.dirname(path.resolve(options.styleProfilePath));
  if (path.basename(provisionalDirectory) !== 'provisional' || path.basename(path.dirname(provisionalDirectory)) !== 'review-v2') fail('unexpected_provisional_directory');
  if (path.dirname(path.resolve(options.approvalReceiptPath)) !== provisionalDirectory) fail('receipt_outside_provisional_directory');
  if (options.bindingAttestationPath !== undefined && path.dirname(path.resolve(options.bindingAttestationPath)) !== provisionalDirectory) fail('attestation_outside_provisional_directory');
  const calibrationRoot = path.resolve(provisionalDirectory, '..', '..', '..');
  const summaryPath = path.join(provisionalDirectory, 'provisional-approval-summary.md');

  const profileFile = await readPrivateStyleFile(options.styleProfilePath, calibrationRoot, options.repositoryRoot);
  const receiptFile = await readPrivateStyleFile(options.approvalReceiptPath, calibrationRoot, options.repositoryRoot);
  const summaryFile = await readPrivateStyleFile(summaryPath, calibrationRoot, options.repositoryRoot);
  const profile = safeJson(profileFile.raw, (value) => provisionalStyleProfileSchema.parse(value));
  const receipt = safeJson(receiptFile.raw, (value) => styleApprovalReceiptSchema.parse(value));
  const expected = options.expectedHashes === undefined ? currentApprovalHashes : options.expectedHashes;
  if (expected !== null) {
    if (receiptFile.hash !== expected.receipt) fail('receipt_hash_mismatch');
    if (profileFile.hash !== expected.provisionalProfile) fail('profile_hash_mismatch');
    if (summaryFile.hash !== expected.summary) fail('summary_hash_mismatch');
  }

  let attestation: ApprovalBindingAttestation | null = null;
  let attestationHash: string | null = null;
  let chainStatus: ResolvedWritingStyleSnapshot['approval_chain_status'];
  if (receipt.version === 2) {
    if (receipt.provisional_profile_sha256 !== profileFile.hash) fail('v2_profile_binding_mismatch');
    chainStatus = 'valid_v2_receipt';
  } else {
    if (options.bindingAttestationPath === undefined) fail('legacy_binding_attestation_required');
    const file = await readPrivateStyleFile(options.bindingAttestationPath, calibrationRoot, options.repositoryRoot);
    attestationHash = file.hash;
    attestation = safeJson(file.raw, (value) => approvalBindingAttestationSchema.parse(value));
    if (attestation.source_receipt.sha256 !== receiptFile.hash) fail('attested_receipt_hash_mismatch');
    if (attestation.provisional_profile.sha256 !== profileFile.hash) fail('attested_profile_hash_mismatch');
    if (attestation.approval_summary.sha256 !== summaryFile.hash) fail('attested_summary_hash_mismatch');
    if (attestation.semantic_changes || attestation.user_reapproval_required) fail('legacy_binding_semantic_change');
    chainStatus = 'valid_legacy_receipt_with_binding_attestation';
  }

  validateDecisions(profile, receipt);
  const decisionSet = canonicalDecisionSet(profile);
  const decisionHash = sha256(JSON.stringify(decisionSet));
  const decisionCount = decisionSet.length;
  if (expected !== null && decisionHash !== expected.decisionSet) fail('decision_set_hash_mismatch');
  if (attestation !== null && (attestation.decision_set_sha256 !== decisionHash || attestation.decision_count !== decisionCount)) fail('attested_decision_set_mismatch');
  if (decisionCount !== profile.counts.finalized_manual_decisions || decisionCount !== 28) fail('decision_count_mismatch');

  const ownerHash = profile.source_profiles.owner.base_file_sha256;
  const referenceHash = profile.source_profiles.reference.base_file_sha256;
  if (receipt.input_evidence.owner_base_profile_sha256 !== ownerHash || receipt.input_evidence.reference_base_profile_sha256 !== referenceHash) fail('receipt_source_profile_hash_mismatch');
  if (attestation !== null) {
    if (attestation.owner_profile_hashes.length !== 1 || attestation.owner_profile_hashes[0]!.sha256 !== ownerHash) fail('owner_profile_hash_mismatch');
    if (attestation.reference_profile_hashes.length !== 1 || attestation.reference_profile_hashes[0]!.sha256 !== referenceHash) fail('reference_profile_hash_mismatch');
    if (!sameSet(attestation.closed_rule_ids, ['OCV-09', 'CON-05'])) fail('closed_rule_ids_mismatch');
    if (!sameSet(attestation.deleted_rule_ids, ['OCV-10'])) fail('deleted_rule_ids_mismatch');
  }

  const all = allRules(profile);
  const excluded = all.filter(({ decision }) => decision === 'pending').map(({ rule_group_id }) => rule_group_id);
  const deleted = all.filter(({ decision }) => decision === 'reject').map(({ rule_group_id }) => rule_group_id);
  if (!sameSet(excluded, ['OCV-09', 'CON-05'])) fail('required_closed_rules_not_closed');
  if (!sameSet(deleted, ['OCV-10'])) fail('required_deleted_rule_not_deleted');
  const activeSource = all.filter(({ decision }) => !['pending', 'reject'].includes(decision));
  const active = activeSource.map((rule) => resolvedRule(rule, profile));
  const scoped = activeSource.filter(({ decision }) => ['keep_with_scope', 'cautious_use', 'scenario_switch'].includes(decision)).map((rule) => resolvedRule(rule, profile));
  if (active.some(({ rule_id }) => excluded.includes(rule_id) || deleted.includes(rule_id))) fail('closed_or_deleted_rule_active');
  if (profile.owner_transfer_policy.allowed.some((item) => !['voice', 'judgment', 'explanation_tendency', 'uncertainty', 'first_person_tendency', 'rhythm_preference', 'limited_lexical_preference'].includes(item))) fail('unapproved_owner_transfer');
  if (profile.reference_transfer_policy.allowed.some((item) => !['structure_technique', 'explanation_technique', 'evidence_placement', 'paragraph_progression', 'cta_technique', 'free_value_completeness'].includes(item))) fail('unapproved_reference_transfer');

  return makeResolved({
    style_status: profile.status,
    approval_chain_status: chainStatus,
    production_eligible: false,
    profile_ids: { owner: profile.source_profiles.owner.base_profile_id, reference: profile.source_profiles.reference.base_profile_id, provisional: profile.provisional_profile_id },
    profile_versions: { provisional: 1 },
    profile_hashes: { owner: ownerHash, reference: referenceHash, provisional: profileFile.hash },
    receipt_hash: receiptFile.hash,
    attestation_hash: attestationHash,
    decision_set_hash: decisionHash,
    active_rules: active,
    scoped_rules: scoped,
    excluded_rule_ids: sorted(excluded),
    deleted_rule_ids: sorted(deleted),
    style_scope: 'owner_shortform_social_proxy',
    platform_fidelity: 'proxy',
    known_gaps: ['不是原生 X 风格。', '不是公众号长文风格。', '公众号长文结构由平台规则、文章类型与 human-writing 共同承担。'],
    confidence_label: 'medium',
  });
}

export function resolveApprovedWritingStyleFixture(snapshot: Omit<ResolvedWritingStyleSnapshot, 'style_status' | 'production_eligible'>): ResolvedWritingStyle {
  return makeResolved({ ...snapshot, style_status: 'approved', production_eligible: true });
}
