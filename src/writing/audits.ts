import type { ResearchPack } from '../research/schemas.js';
import type { ProductProfile } from '../product/product-profile.js';
import { lintHumanWriting } from '../writing-lint/human-writing-lint.js';
import { lintNoAiSlop } from '../writing-lint/no-ai-slop-lint.js';
import type { WritingIssue as ExistingWritingIssue } from '../writing-skills/types.js';
import { writingAuditSchema, type ContentBlock, type MasterDraft, type WechatDraft, type WritingAudit, type XDraft } from './schemas.js';
import type { WritingStyleRecipes } from './style-recipe.js';
import type { ResolvedWritingStyleSnapshot } from './schemas.js';

interface AuditIssue { issue_code: string; severity: 'hard_blocker' | 'blocking_style_issue' | 'warning' | 'profile_preference'; location: string; quoted_text: string; repair_constraint: string }

function issue(issue_code: string, location: string, quoted_text: string, repair_constraint: string, severity: AuditIssue['severity'] = 'hard_blocker'): AuditIssue {
  return { issue_code, severity, location, quoted_text: quoted_text.slice(0, 1_000), repair_constraint };
}

function fromExisting(value: ExistingWritingIssue): AuditIssue {
  return { issue_code: value.issue_code, severity: value.severity, location: value.location, quoted_text: value.quoted_text, repair_constraint: value.repair_constraint };
}

function allText(master: MasterDraft, wechat: WechatDraft, x: XDraft): string {
  void master;
  return [wechat.article_markdown, ...wechat.alternative_titles, wechat.abstract, wechat.cta.text,
    x.single_post ?? '', ...x.thread, x.debate_prompt ?? ''].join('\n');
}

function blocking(issues: readonly AuditIssue[]): boolean { return issues.some(({ severity }) => severity === 'hard_blocker' || severity === 'blocking_style_issue'); }

function evidenceAudit(blocks: readonly ContentBlock[], research: ResearchPack, publicText: string) {
  const issues: AuditIssue[] = [];
  const claims = new Map(research.verified_claims.map((claim) => [claim.claim_id, claim]));
  const used = new Set<string>();
  for (const block of blocks) {
    if (!block.is_opinion && block.claim_ids.length === 0) issues.push(issue('factual_block_without_claim', block.block_id, block.text, 'Attach a supported Research claim or mark a genuine opinion.'));
    for (const claimId of block.claim_ids) {
      const claim = claims.get(claimId);
      if (claim === undefined) issues.push(issue('unknown_claim_id', block.block_id, claimId, 'Use only verified Research Pack claims.'));
      else if (claim.support_status === 'unsupported') issues.push(issue('unsupported_claim_used', block.block_id, claimId, 'Remove the unsupported claim.'));
      else {
        used.add(claimId);
        if (claim.support_status === 'partial' && (!block.text.startsWith('目前能确认的是') || !block.text.includes(claim.scope_limit))) issues.push(issue('partial_claim_overstated', block.block_id, block.text, 'Begin with the bounded phrase and preserve scope_limit.'));
      }
    }
  }
  for (const claimId of research.writing_requirements.required_claim_ids) if (!used.has(claimId)) issues.push(issue('required_claim_missing', 'writing_pack', claimId, 'Use every required claim in an evidence-linked block.'));
  for (const disclosure of research.writing_requirements.required_disclosures) if (!publicText.includes(disclosure)) issues.push(issue('required_disclosure_missing', 'writing_pack', disclosure, 'Preserve this Research limitation verbatim.'));
  if (/(?:claim_|source_[a-f0-9]|segment_id|input_hash|profile_id|style_rule|\/Users\/)/u.test(publicText)) issues.push(issue('internal_identifier_leaked', 'public_output', '', 'Remove internal IDs, hashes, and local paths from public copy.'));
  return { status: blocking(issues) ? 'blocked' as const : 'pass' as const, issues, checked_items: ['all factual blocks carry evidence', 'required claims used', 'partial claims bounded', 'internal identifiers absent'], required_claim_ids: research.writing_requirements.required_claim_ids, used_claim_ids: [...used] };
}

function experimentAudit(blocks: readonly ContentBlock[], research: ResearchPack, publicText: string) {
  const issues: AuditIssue[] = [];
  const experimentBlocks = blocks.filter(({ experiment_refs }) => experiment_refs.length > 0);
  const knownVariants = new Set(research.experiment?.results.map(({ variant_id }) => variant_id) ?? []);
  for (const block of experimentBlocks) for (const reference of block.experiment_refs) if (!knownVariants.has(reference)) issues.push(issue('unknown_experiment_reference', block.block_id, reference, 'Use only saved experiment results.'));
  if (experimentBlocks.length > 0 && research.experiment === null) issues.push(issue('experiment_result_without_bundle', 'writing_pack', '', 'Remove experiment conclusions without a saved bundle.'));
  for (const forbidden of ['效率提升', '准确率提升', '一定更快', '一定更好', '最佳工作流', '长期亲测']) {
    let cursor = publicText.indexOf(forbidden);
    while (cursor >= 0) {
      const prefix = publicText.slice(Math.max(0, cursor - 24), cursor);
      if (!/(?:不能|不得|不可|不应|没有|不代表|禁止|避免)/u.test(prefix)) issues.push(issue('experiment_overclaim', 'public_output', forbidden, 'Remove unmeasured or extrapolated experiment claims.'));
      cursor = publicText.indexOf(forbidden, cursor + forbidden.length);
    }
  }
  if (/%|％/u.test(publicText)) issues.push(issue('unverified_percentage', 'public_output', '%', 'Do not state an experiment percentage.'));
  for (const limitation of research.experiment?.limitations ?? []) if (!publicText.includes(limitation)) issues.push(issue('experiment_limitation_missing', 'public_output', limitation, 'Preserve the saved experiment limitation.'));
  return { status: blocking(issues) ? 'blocked' as const : 'pass' as const, issues, checked_items: ['experiment references resolve', 'saved numbers only', 'single-sample and single-run limitations preserved', 'no extrapolation'] };
}

function productAudit(blocks: readonly ContentBlock[], research: ResearchPack, product: ProductProfile, publicText: string, ctaMode: 'none' | 'light', productBridgeAllowed: boolean) {
  const issues: AuditIssue[] = [];
  const forbidden = ['365 元', '365元', '499 元', '499元', '剩余名额', '涨价倒计时', '会员人数', '教程数量', '固定更新频率', '固定答疑频率', '保证学会', '保证变现', '一对一辅导', '退款政策'];
  for (const phrase of forbidden) if (publicText.includes(phrase)) issues.push(issue('forbidden_product_claim', 'public_output', phrase, 'Remove unconfirmed price, scarcity, entitlement, cadence, or guarantee.'));
  const confirmed = new Set(product.claims.confirmed);
  for (const block of blocks) for (const claimId of block.product_claim_ids) {
    if (!confirmed.has(claimId)) issues.push(issue('unconfirmed_product_claim_id', block.block_id, claimId, 'Use only a confirmed product claim from config/product.yaml.'));
    if (!productBridgeAllowed) issues.push(issue('product_bridge_disabled', block.block_id, claimId, 'CON-05 is closed; remove product bridging from this Provisional result.'));
  }
  if (research.topic?.cta_mode === 'none' && ctaMode !== 'none') issues.push(issue('cta_escalated', 'wechat.cta', ctaMode, 'CTA cannot exceed the Research plan.'));
  return { status: blocking(issues) ? 'blocked' as const : 'pass' as const, issues, checked_items: ['CTA not upgraded', 'CON-05 product bridge disabled', 'public price omitted', 'unconfirmed benefits absent'], requested_cta_mode: research.topic?.cta_mode ?? null, effective_cta_mode: ctaMode };
}

function firstPersonAudit(blocks: readonly ContentBlock[]) {
  const issues: AuditIssue[] = [];
  const sentences: Array<{ sentence: string; type: 'opinion' | 'factual'; evidence_refs: string[]; allowed: boolean }> = [];
  const factualPattern = /我(?:测试了|最近用了|做过|发现|的用户|的学员)/u;
  const opinionPattern = /我(?:的判断是|更建议|不会|认为)/u;
  for (const block of blocks) {
    for (const sentence of block.text.split(/(?<=[。！？])/u).map((value) => value.trim()).filter((value) => value.includes('我'))) {
      const type = factualPattern.test(sentence) ? 'factual' as const : 'opinion' as const;
      const evidence = [...block.persona_fact_ids, ...block.claim_ids, ...block.experiment_refs];
      const allowed = type === 'opinion' ? block.is_opinion && opinionPattern.test(sentence) : evidence.length > 0 && block.persona_fact_ids.length > 0;
      sentences.push({ sentence, type, evidence_refs: evidence, allowed });
      if (!allowed) issues.push(issue(type === 'factual' ? 'unsupported_first_person_fact' : 'unmarked_first_person_opinion', block.block_id, sentence, type === 'factual' ? 'Remove the personal fact or attach real persona/project evidence.' : 'Mark genuine judgment as opinion and use an approved form.'));
    }
  }
  return { status: blocking(issues) ? 'blocked' as const : 'pass' as const, issues, checked_items: ['opinion first-person marked', 'factual first-person evidence required'], sentences };
}

function styleAudit(blocks: readonly ContentBlock[], publicText: string, recipes: WritingStyleRecipes, style: ResolvedWritingStyleSnapshot) {
  const issues: AuditIssue[] = [];
  const selected = new Set(recipes.selected_rule_ids);
  for (const block of blocks) for (const id of block.style_rule_ids) if (!selected.has(id)) issues.push(issue('unselected_style_rule_used', block.block_id, id, 'Use only rules selected by the Style Recipe.'));
  for (const id of [...style.excluded_rule_ids, ...style.deleted_rule_ids]) if (blocks.some(({ style_rule_ids }) => style_rule_ids.includes(id))) issues.push(issue('closed_style_rule_used', 'writing_pack', id, 'Remove closed or deleted rules from Writer input and output.'));
  if (recipes.wechat.selected_rules.some(({ source_role, category }) => source_role === 'reference' && ['voice', 'lexical', 'first_person'].includes(category))) issues.push(issue('reference_voice_transfer', 'style_recipe', '', 'Reference may provide techniques only.'));
  const humanIssues = lintHumanWriting(publicText).map(fromExisting);
  const noAiIssues = lintNoAiSlop(publicText).map(fromExisting);
  issues.push(...humanIssues, ...noAiIssues);
  return { status: blocking(issues) ? 'blocked' as const : 'pass' as const, issues, checked_items: ['selected rules only', 'reference technique only', 'human-writing post-draft lint', 'no-ai-slop detect-only'] };
}

export function runDeterministicWritingAudits(input: {
  master: MasterDraft; wechat: WechatDraft; x: XDraft; research: ResearchPack; product: ProductProfile; recipes: WritingStyleRecipes; style: ResolvedWritingStyleSnapshot; qualityIssues?: AuditIssue[];
}): WritingAudit {
  const publicText = allText(input.master, input.wechat, input.x);
  const effectiveCta = input.wechat.cta.mode;
  const evidence = evidenceAudit(input.master.blocks, input.research, publicText);
  const experiment = experimentAudit(input.master.blocks, input.research, publicText);
  const product = productAudit(input.master.blocks, input.research, input.product, publicText, effectiveCta, !input.style.excluded_rule_ids.includes('CON-05'));
  const firstPerson = firstPersonAudit(input.master.blocks);
  const style = styleAudit(input.master.blocks, publicText, input.recipes, input.style);
  return writingAuditSchema.parse({
    evidence, experiment, product, first_person: firstPerson, style,
    plagiarism: { status: 'pass', issues: [], checked_items: ['pending final local guards'], protected_transfer_detected: false, reference_overlap_detected: false },
    unknowns: [...input.style.known_gaps, ...input.research.readiness.open_gaps],
    quality_issues: input.qualityIssues ?? [],
  });
}

export function blockingAuditIssues(audit: WritingAudit): AuditIssue[] {
  return [audit.evidence, audit.experiment, audit.product, audit.first_person, audit.style]
    .flatMap(({ issues }) => issues)
    .concat(audit.quality_issues)
    .filter(({ severity }) => severity === 'hard_blocker' || severity === 'blocking_style_issue');
}

export function withPlagiarismAudit(audit: WritingAudit, result: { status: 'pass' | 'blocked'; issues: AuditIssue[] }): WritingAudit {
  const protectedTransfer = result.issues.some(({ issue_code }) => ['signature_phrase_transfer', 'unique_metaphor_transfer', 'personal_experience_transfer'].includes(issue_code));
  const referenceOverlap = result.issues.some(({ issue_code }) => issue_code === 'public_reference_text_overlap');
  const sanitized = result.issues.map((item) => ({ ...item, quoted_text: item.issue_code === 'public_reference_text_overlap' ? '[redacted reference overlap]' : '[redacted protected match]' }));
  return writingAuditSchema.parse({ ...audit, plagiarism: { status: result.status, issues: sanitized, checked_items: ['continuous overlap', 'Chinese 12-gram overlap', 'protected transfer index', 'authorized exact Research quotes'], protected_transfer_detected: protectedTransfer, reference_overlap_detected: referenceOverlap } });
}
