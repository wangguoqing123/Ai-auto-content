import type { ProductProfile } from '../product/product-profile.js';
import type { ResearchPack } from '../research/schemas.js';
import { lintHumanWriting } from '../writing-lint/human-writing-lint.js';
import { lintNoAiSlop } from '../writing-lint/no-ai-slop-lint.js';
import type { WritingIssue as ExistingWritingIssue } from '../writing-skills/types.js';
import { enumeratePublicContentUnits } from './public-content-units.js';
import {
  writingAuditSchema,
  writingIssueSchema,
  type MasterDraft,
  type PublicContentUnit,
  type ResolvedWritingStyleSnapshot,
  type WechatDraft,
  type WriterOutput,
  type WritingAudit,
  type WritingIssue,
  type XDraft,
} from './schemas.js';
import type { WritingStyleRecipes } from './style-recipe.js';

function issue(
  issue_code: string,
  unit: Pick<PublicContentUnit, 'unit_id' | 'surface'>,
  quoted_text: string,
  repair_constraint: string,
  severity: WritingIssue['severity'] = 'hard_blocker',
  rule_origin = 'project',
  source_commit = 'project-v0',
): WritingIssue {
  return writingIssueSchema.parse({ issue_code, severity, unit_id: unit.unit_id, surface: unit.surface, rule_origin, source_commit, quoted_text: quoted_text.slice(0, 1_000), repair_constraint });
}

function contractIssue(issue_code: string, quoted_text: string, repair_constraint: string, surface: 'writing_contract' | 'visual_slots' | 'writing_pack' = 'writing_contract'): WritingIssue {
  return writingIssueSchema.parse({ issue_code, severity: 'hard_blocker', unit_id: surface === 'visual_slots' ? 'writing.visual_slots' : 'writing.contract', surface, rule_origin: 'project', source_commit: 'project-v0', quoted_text, repair_constraint });
}

function fromExisting(value: ExistingWritingIssue, unit: PublicContentUnit): WritingIssue {
  return issue(value.issue_code, unit, value.quoted_text, value.repair_constraint, value.severity, value.rule_origin, value.source_commit);
}

function blocking(issues: readonly WritingIssue[]): boolean { return issues.some(({ severity }) => severity === 'hard_blocker' || severity === 'blocking_style_issue'); }
function nonEmpty(units: readonly PublicContentUnit[]): PublicContentUnit[] { return units.filter(({ text }) => text.trim() !== ''); }

function boundaryUnit(output: WriterOutput, units: readonly PublicContentUnit[]): PublicContentUnit {
  const boundary = output.blocks.find(({ block_type }) => block_type === 'boundary');
  return units.find(({ unit_id }) => unit_id === `wechat.block.${boundary?.block_id}`) ?? units.find(({ surface }) => surface === 'wechat_abstract')!;
}

function evidenceAudit(output: WriterOutput, units: readonly PublicContentUnit[], research: ResearchPack) {
  const issues: WritingIssue[] = [];
  const claims = new Map(research.verified_claims.map((claim) => [claim.claim_id, claim]));
  const used = new Set<string>();
  const titleSurfaces = new Set<PublicContentUnit['surface']>(['wechat_primary_title', 'wechat_alternative_title']);
  for (const unit of nonEmpty(units)) {
    if (!unit.is_opinion && unit.claim_ids.length === 0) issues.push(issue('factual_unit_without_claim', unit, unit.text, 'Attach a supported Research claim or mark a genuine opinion.'));
    for (const claimId of unit.claim_ids) {
      const claim = claims.get(claimId);
      if (claim === undefined) issues.push(issue('unknown_claim_id', unit, claimId, 'Use only verified Research Pack claims.'));
      else if (claim.support_status === 'unsupported') issues.push(issue('unsupported_claim_used', unit, claimId, 'Remove the unsupported claim.'));
      else {
        used.add(claimId);
        if (claim.support_status === 'partial' && titleSurfaces.has(unit.surface)) issues.push(issue('partial_claim_in_title', unit, unit.text, 'A partial claim cannot appear in a WeChat title.'));
        if (claim.support_status === 'partial' && (!unit.text.startsWith('目前能确认的是') || !unit.text.includes(claim.scope_limit))) issues.push(issue('partial_claim_overstated', unit, unit.text, 'Begin with the bounded phrase and preserve scope_limit.'));
      }
    }
    if (/(?:claim_|source_[a-f0-9]|segment_id|input_hash|profile_id|style_rule|\/Users\/)/u.test(unit.text)) issues.push(issue('internal_identifier_leaked', unit, '', 'Remove internal IDs, hashes, and local paths from public copy.'));
  }
  const fallback = boundaryUnit(output, units);
  for (const claimId of research.writing_requirements.required_claim_ids) if (!used.has(claimId)) issues.push(issue('required_claim_missing', fallback, claimId, 'Use every required claim in an evidence-linked unit.'));
  for (const disclosure of research.writing_requirements.required_disclosures) if (!units.some(({ text }) => text.includes(disclosure))) issues.push(issue('required_disclosure_missing', fallback, disclosure, 'Preserve this Research limitation verbatim.'));
  return { status: blocking(issues) ? 'blocked' as const : 'pass' as const, issues, checked_items: ['every public factual unit carries evidence', 'required claims used', 'partial claims bounded and excluded from titles', 'internal identifiers absent'], required_claim_ids: research.writing_requirements.required_claim_ids, used_claim_ids: [...used] };
}

function hasExperimentLanguage(text: string): boolean {
  return /(?:实验结果|每组只|模型波动|不能外推|通过\s*\d+\s*项|效率提升|准确率提升|最佳工作流)/u.test(text);
}

function experimentAudit(output: WriterOutput, units: readonly PublicContentUnit[], research: ResearchPack) {
  const issues: WritingIssue[] = [];
  const known = new Set(research.experiment?.results.map(({ variant_id }) => variant_id) ?? []);
  for (const unit of nonEmpty(units)) {
    for (const reference of unit.experiment_refs) if (!known.has(reference)) issues.push(issue('unknown_experiment_reference', unit, reference, 'Use only saved experiment results.'));
    if (unit.experiment_refs.length > 0 && research.experiment === null) issues.push(issue('experiment_result_without_bundle', unit, '', 'Remove experiment conclusions without a saved bundle.'));
    if (hasExperimentLanguage(unit.text) && unit.experiment_refs.length === 0) issues.push(issue('experiment_reference_missing', unit, unit.text, 'Bind experiment language and numbers to saved experiment_refs.'));
    for (const forbidden of ['效率提升', '准确率提升', '一定更快', '一定更好', '最佳工作流', '长期亲测']) {
      let cursor = unit.text.indexOf(forbidden);
      while (cursor >= 0) {
        const prefix = unit.text.slice(Math.max(0, cursor - 24), cursor);
        if (!/(?:不能|不得|不可|不应|没有|不代表|禁止|避免)/u.test(prefix)) issues.push(issue('experiment_overclaim', unit, forbidden, 'Remove unmeasured or extrapolated experiment claims.'));
        cursor = unit.text.indexOf(forbidden, cursor + forbidden.length);
      }
    }
    if (/%|％/u.test(unit.text)) issues.push(issue('unverified_percentage', unit, '%', 'Do not state an experiment percentage.'));
  }
  const fallback = boundaryUnit(output, units);
  for (const limitation of research.experiment?.limitations ?? []) if (!units.some(({ text }) => text.includes(limitation))) issues.push(issue('experiment_limitation_missing', fallback, limitation, 'Preserve the saved experiment limitation.'));
  return { status: blocking(issues) ? 'blocked' as const : 'pass' as const, issues, checked_items: ['every public unit experiment reference resolves', 'saved numbers only', 'limitations preserved in a bounded unit', 'no cross-unit extrapolation'] };
}

function productAudit(output: WriterOutput, units: readonly PublicContentUnit[], research: ResearchPack, product: ProductProfile, productBridgeAllowed: boolean) {
  const issues: WritingIssue[] = [];
  const forbidden = ['365 元', '365元', '499 元', '499元', '剩余名额', '涨价倒计时', '会员人数', '教程数量', '固定更新频率', '固定答疑频率', '保证学会', '保证变现', '一对一辅导', '退款政策'];
  const confirmed = new Set(product.claims.confirmed);
  for (const unit of nonEmpty(units)) {
    for (const phrase of forbidden) if (unit.text.includes(phrase)) issues.push(issue('forbidden_product_claim', unit, phrase, 'Remove unconfirmed price, scarcity, entitlement, cadence, or guarantee.'));
    const productLanguage = /(?:俱乐部|会员|课程|权益|价格|购买|报名|名额|退款|答疑)/u.test(unit.text);
    if (productLanguage && unit.product_claim_ids.length === 0) issues.push(issue('product_claim_without_id', unit, unit.text, 'Bind product language to an allowed product_claim_id or remove it.'));
    for (const claimId of unit.product_claim_ids) {
      if (!confirmed.has(claimId)) issues.push(issue('unconfirmed_product_claim_id', unit, claimId, 'Use only a confirmed product claim from config/product.yaml.'));
      if (!productBridgeAllowed) issues.push(issue('product_bridge_disabled', unit, claimId, 'CON-05 is closed; remove product bridging from this Provisional result.'));
    }
  }
  if (research.topic?.cta_mode === 'none' && output.cta.mode !== 'none') issues.push(contractIssue('cta_escalated', output.cta.mode, 'CTA mode cannot exceed the Research plan.'));
  return { status: blocking(issues) ? 'blocked' as const : 'pass' as const, issues, checked_items: ['every public surface product expression audited', 'CTA not upgraded', 'CON-05 product bridge disabled', 'public price omitted'], requested_cta_mode: research.topic?.cta_mode ?? null, effective_cta_mode: output.cta.mode };
}

function firstPersonAudit(units: readonly PublicContentUnit[]) {
  const issues: WritingIssue[] = [];
  const sentences: Array<{ sentence: string; type: 'opinion' | 'factual'; evidence_refs: string[]; allowed: boolean }> = [];
  const factualPattern = /我(?:测试了|实测|最近用了|做过|发现|的用户|的学员)/u;
  const opinionPattern = /我(?:的判断是|更建议|不会|认为)/u;
  for (const unit of nonEmpty(units)) {
    for (const sentence of unit.text.split(/(?<=[。！？])/u).map((value) => value.trim()).filter((value) => value.includes('我'))) {
      const type = factualPattern.test(sentence) ? 'factual' as const : 'opinion' as const;
      const evidence = [...unit.persona_fact_ids, ...unit.claim_ids, ...unit.experiment_refs];
      const allowed = type === 'opinion' ? unit.is_opinion && opinionPattern.test(sentence) : unit.persona_fact_ids.length > 0;
      sentences.push({ sentence, type, evidence_refs: evidence, allowed });
      if (!allowed) issues.push(issue(type === 'factual' ? 'unsupported_first_person_fact' : 'unmarked_first_person_opinion', unit, sentence, type === 'factual' ? 'Remove the personal fact or attach real persona/project evidence.' : 'Mark genuine judgment as opinion and use an approved form.'));
    }
  }
  return { status: blocking(issues) ? 'blocked' as const : 'pass' as const, issues, checked_items: ['every public unit first-person use audited', 'opinion first-person marked', 'factual first-person evidence required'], sentences };
}

function styleAudit(units: readonly PublicContentUnit[], recipes: WritingStyleRecipes, style: ResolvedWritingStyleSnapshot) {
  const issues: WritingIssue[] = [];
  const selected = new Set(recipes.selected_rule_ids);
  for (const unit of nonEmpty(units)) {
    for (const id of unit.style_rule_ids) if (!selected.has(id)) issues.push(issue('unselected_style_rule_used', unit, id, 'Use only rules selected by the Style Recipe.'));
    for (const id of [...style.excluded_rule_ids, ...style.deleted_rule_ids]) if (unit.style_rule_ids.includes(id)) issues.push(issue('closed_style_rule_used', unit, id, 'Remove closed or deleted rules from Writer input and output.'));
    issues.push(...lintHumanWriting(unit.text).map((value) => fromExisting(value, unit)));
    issues.push(...lintNoAiSlop(unit.text).map((value) => fromExisting(value, unit)));
  }
  if (recipes.wechat.selected_rules.some(({ source_role, category }) => source_role === 'reference' && ['voice', 'lexical', 'first_person'].includes(category))) issues.push(contractIssue('reference_voice_transfer', '', 'Reference may provide techniques only.'));
  return { status: blocking(issues) ? 'blocked' as const : 'pass' as const, issues, checked_items: ['every public unit linted independently', 'stable unit location used', 'selected rules only', 'reference technique only'] };
}

export function runDeterministicWritingAudits(input: {
  output: WriterOutput;
  master: MasterDraft;
  wechat: WechatDraft;
  x: XDraft;
  research: ResearchPack;
  product: ProductProfile;
  recipes: WritingStyleRecipes;
  style: ResolvedWritingStyleSnapshot;
  qualityIssues?: WritingIssue[];
}): WritingAudit {
  void input.master; void input.wechat; void input.x;
  const units = enumeratePublicContentUnits(input.output);
  const evidence = evidenceAudit(input.output, units, input.research);
  const experiment = experimentAudit(input.output, units, input.research);
  const product = productAudit(input.output, units, input.research, input.product, !input.style.excluded_rule_ids.includes('CON-05'));
  const firstPerson = firstPersonAudit(units);
  const style = styleAudit(units, input.recipes, input.style);
  return writingAuditSchema.parse({
    evidence, experiment, product, first_person: firstPerson, style,
    plagiarism: { status: 'not_run', issues: [], checked_items: ['Guard not executed'], protected_transfer_detected: null, reference_overlap_detected: null },
    unknowns: [...input.style.known_gaps, ...input.research.readiness.open_gaps],
    quality_issues: input.qualityIssues ?? [],
  });
}

export function blockingAuditIssues(audit: WritingAudit): WritingIssue[] {
  return [audit.evidence, audit.experiment, audit.product, audit.first_person, audit.style]
    .flatMap(({ issues }) => issues)
    .concat(audit.quality_issues)
    .filter(({ severity }) => severity === 'hard_blocker' || severity === 'blocking_style_issue');
}

export function withPlagiarismAudit(audit: WritingAudit, result: { status: 'pass' | 'blocked'; issues: ExistingWritingIssue[] }): WritingAudit {
  const protectedTransfer = result.issues.some(({ issue_code }) => ['signature_phrase_transfer', 'unique_metaphor_transfer', 'personal_experience_transfer'].includes(issue_code));
  const referenceOverlap = result.issues.some(({ issue_code }) => issue_code === 'public_reference_text_overlap');
  const sanitized = result.issues.map((value) => writingIssueSchema.parse({
    issue_code: value.issue_code,
    severity: value.severity,
    unit_id: 'writing.guard',
    surface: 'writing_pack',
    rule_origin: value.rule_origin,
    source_commit: value.source_commit,
    quoted_text: value.issue_code === 'public_reference_text_overlap' ? '[redacted reference overlap]' : '[redacted protected match]',
    repair_constraint: value.repair_constraint,
  }));
  return writingAuditSchema.parse({ ...audit, plagiarism: { status: result.status, issues: sanitized, checked_items: ['continuous overlap', 'Chinese 12-gram overlap', 'protected transfer index', 'authorized exact Research quotes'], protected_transfer_detected: protectedTransfer, reference_overlap_detected: referenceOverlap } });
}
