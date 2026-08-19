import { applyPublicContentUnitPatches, enumeratePublicContentUnits, publicContentUnitSha256 } from './public-content-units.js';
import { repairOutputSchema, writerOutputSchema, type PublicContentUnit, type RepairOutput, type WriterOutput, type WritingIssue } from './schemas.js';

export const repairableFields = ['text', 'claim_ids', 'experiment_refs', 'product_claim_ids', 'persona_fact_ids', 'style_rule_ids', 'is_opinion'] as const;
export type RepairableField = typeof repairableFields[number];
export type Repairability = 'text_patch' | 'metadata_patch' | 'non_repairable_contract';

export interface RepairIssueGroup {
  unit_id: string;
  surface: string;
  issue_codes: string[];
  rule_origins: string[];
  quoted_fragments: string[];
  constraints: string[];
}

export interface RepairTarget {
  unit_id: string;
  surface: PublicContentUnit['surface'];
  original_sha256: string;
  current_unit: PublicContentUnit;
  issue_codes: string[];
  constraints: string[];
  allowed_fields: RepairableField[];
}

export interface RepairPlan {
  groups: RepairIssueGroup[];
  targets: RepairTarget[];
  non_repairable: WritingIssue[];
}

const nonRepairableCodes = new Set([
  'article_type_mismatch', 'x_format_mismatch', 'unknown_claim_id', 'unknown_experiment_reference',
  'unselected_style_rule_used', 'closed_style_rule_used', 'visual_generation_attempted',
  'output_shape_invalid', 'title_count_invalid', 'thread_count_invalid', 'reference_voice_transfer',
  'cta_escalated', 'unconfirmed_product_claim_id',
]);

const styleCodes = new Set([
  'reversal_rhetoric', 'binary_contrast', 'faux_insight', 'faux_insight_setup', 'model_signpost', 'nominalization',
  'mechanical_parallelism', 'business_jargon', 'throat_clearing', 'superficial_analysis', 'importance_puffery',
  'interpretive_metadiscourse', 'weasel_attribution', 'rhetorical_setup', 'colon_reveal', 'summary_recap_ending',
  'mechanical_summary_ending', 'fake_profound_ending', 'uniform_sentence_length', 'consecutive_short_sentences',
  'exact_duplicate_paragraph', 'wechat_length_out_of_range', 'x_item_too_long',
]);
const firstPersonCodes = new Set(['unsupported_first_person_fact', 'unmarked_first_person_opinion']);
const evidenceCodes = new Set(['factual_unit_without_claim', 'unsupported_claim_used', 'partial_claim_in_title', 'partial_claim_overstated', 'required_claim_missing', 'required_disclosure_missing', 'internal_identifier_leaked']);
const experimentCodes = new Set(['experiment_result_without_bundle', 'experiment_overclaim', 'unverified_percentage', 'experiment_limitation_missing', 'experiment_reference_missing']);
const productCodes = new Set(['forbidden_product_claim', 'product_bridge_disabled', 'product_claim_without_id']);

export function classifyRepairability(issue: WritingIssue): { repairability: Repairability; allowed_fields: RepairableField[] } {
  if (nonRepairableCodes.has(issue.issue_code) || issue.surface === 'writing_contract' || issue.surface === 'visual_slots') return { repairability: 'non_repairable_contract', allowed_fields: [] };
  if (styleCodes.has(issue.issue_code)) return { repairability: 'text_patch', allowed_fields: ['text'] };
  if (firstPersonCodes.has(issue.issue_code)) return { repairability: 'metadata_patch', allowed_fields: ['text', 'persona_fact_ids', 'is_opinion'] };
  if (evidenceCodes.has(issue.issue_code)) return { repairability: 'metadata_patch', allowed_fields: ['text', 'claim_ids', 'is_opinion'] };
  if (experimentCodes.has(issue.issue_code)) return { repairability: 'metadata_patch', allowed_fields: ['text', 'experiment_refs'] };
  if (productCodes.has(issue.issue_code)) return { repairability: 'metadata_patch', allowed_fields: ['text', 'product_claim_ids'] };
  return { repairability: 'non_repairable_contract', allowed_fields: [] };
}

function normalizedFragment(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase();
}

function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }

export function buildRepairPlan(output: WriterOutput, issues: readonly WritingIssue[]): RepairPlan {
  const units = new Map(enumeratePublicContentUnits(output).map((unit) => [unit.unit_id, unit]));
  const nonRepairable: WritingIssue[] = [];
  const groupMap = new Map<string, RepairIssueGroup>();
  const fieldsByUnit = new Map<string, RepairableField[]>();
  for (const issue of issues) {
    const classification = classifyRepairability(issue);
    const unit = units.get(issue.unit_id);
    if (classification.repairability === 'non_repairable_contract' || unit === undefined) {
      nonRepairable.push(issue);
      continue;
    }
    const key = `${issue.unit_id}\n${normalizedFragment(issue.quoted_text)}`;
    const current = groupMap.get(key) ?? {
      unit_id: issue.unit_id,
      surface: issue.surface,
      issue_codes: [],
      rule_origins: [],
      quoted_fragments: [],
      constraints: [],
    };
    current.issue_codes = unique([...current.issue_codes, issue.issue_code]);
    current.rule_origins = unique([...current.rule_origins, issue.rule_origin]);
    current.quoted_fragments = unique([...current.quoted_fragments, issue.quoted_text].filter(Boolean));
    current.constraints = unique([...current.constraints, issue.repair_constraint]);
    groupMap.set(key, current);
    fieldsByUnit.set(issue.unit_id, unique([...(fieldsByUnit.get(issue.unit_id) ?? []), ...classification.allowed_fields]));
  }
  const groups = [...groupMap.values()];
  const targetMap = new Map<string, RepairTarget>();
  for (const group of groups) {
    const unit = units.get(group.unit_id)!;
    const existing = targetMap.get(group.unit_id);
    targetMap.set(group.unit_id, {
      unit_id: group.unit_id,
      surface: unit.surface,
      original_sha256: publicContentUnitSha256(unit),
      current_unit: unit,
      issue_codes: unique([...(existing?.issue_codes ?? []), ...group.issue_codes]),
      constraints: unique([...(existing?.constraints ?? []), ...group.constraints]),
      allowed_fields: fieldsByUnit.get(group.unit_id) ?? [],
    });
  }
  return { groups, targets: [...targetMap.values()], non_repairable: nonRepairable };
}

export class RepairContractError extends Error {
  readonly code = 'writing_output_invalid';
  constructor(readonly reason: string) { super('writing_output_invalid'); this.name = 'RepairContractError'; }
}

function fail(reason: string): never { throw new RepairContractError(reason); }

export interface ApplyUnitRepairOptions {
  allowedClaimIds: ReadonlySet<string>;
  allowedExperimentRefs: ReadonlySet<string>;
  allowedProductClaimIds: ReadonlySet<string>;
  allowedPersonaFactIds: ReadonlySet<string>;
  allowedStyleRuleIds: ReadonlySet<string>;
}

export function applyUnitRepair(outputInput: WriterOutput, targetsInput: readonly RepairTarget[], repairInput: RepairOutput, options: ApplyUnitRepairOptions): WriterOutput {
  const output = writerOutputSchema.parse(outputInput);
  const repair = repairOutputSchema.parse(repairInput);
  const targets = new Map<string, RepairTarget>();
  for (const target of targetsInput) {
    if (targets.has(target.unit_id)) fail('duplicate_repair_target');
    targets.set(target.unit_id, target);
  }
  const currentUnits = new Map(enumeratePublicContentUnits(output).map((unit) => [unit.unit_id, unit]));
  const seen = new Set<string>();
  const patches: PublicContentUnit[] = [];
  for (const patch of repair.repaired_units) {
    if (seen.has(patch.unit_id)) fail('duplicate_unit_patch');
    seen.add(patch.unit_id);
    const target = targets.get(patch.unit_id);
    if (target === undefined) fail('repair_modified_unlisted_unit');
    const current = currentUnits.get(patch.unit_id);
    if (current === undefined) fail('repair_unit_missing');
    const currentHash = publicContentUnitSha256(current);
    if (patch.original_sha256 !== target.original_sha256 || patch.original_sha256 !== currentHash) fail('repair_original_sha256_mismatch');
    const replacement = patch.replacement;
    for (const field of repairableFields) {
      if (!target.allowed_fields.includes(field) && JSON.stringify(replacement[field]) !== JSON.stringify(current[field])) fail(`repair_field_not_allowed:${field}`);
    }
    const changedAllowedField = target.allowed_fields.some((field) => JSON.stringify(replacement[field]) !== JSON.stringify(current[field]));
    if (!changedAllowedField) fail(`repair_target_unchanged:${patch.unit_id}`);
    const validateIds = (values: readonly string[], allowed: ReadonlySet<string>, code: string) => { if (values.some((value) => !allowed.has(value))) fail(code); };
    validateIds(replacement.claim_ids, options.allowedClaimIds, 'repair_claim_id_not_allowed');
    validateIds(replacement.experiment_refs, options.allowedExperimentRefs, 'repair_experiment_ref_not_allowed');
    validateIds(replacement.product_claim_ids, options.allowedProductClaimIds, 'repair_product_claim_id_not_allowed');
    validateIds(replacement.persona_fact_ids, options.allowedPersonaFactIds, 'repair_persona_fact_id_not_allowed');
    validateIds(replacement.style_rule_ids, options.allowedStyleRuleIds, 'repair_style_rule_id_not_allowed');
    patches.push({ ...current, ...replacement });
  }
  for (const unitId of targets.keys()) if (!seen.has(unitId)) fail(`repair_target_missing:${unitId}`);
  const repaired = applyPublicContentUnitPatches(output, patches);
  if (repaired.article_type !== output.article_type) fail('repair_changed_article_type');
  if (repaired.x.format !== output.x.format) fail('repair_changed_x_format');
  if (repaired.x.thread.items.length !== output.x.thread.items.length) fail('repair_changed_thread_count');
  if (repaired.alternative_titles.length !== output.alternative_titles.length) fail('repair_changed_title_count');
  if (repaired.blocks.some((block, index) => block.block_id !== output.blocks[index]?.block_id || block.block_type !== output.blocks[index]?.block_type)) fail('repair_changed_block_identity');
  const beforeIds = enumeratePublicContentUnits(output).map(({ unit_id }) => unit_id);
  const afterIds = enumeratePublicContentUnits(repaired).map(({ unit_id }) => unit_id);
  if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) fail('repair_changed_unit_set');
  return repaired;
}
