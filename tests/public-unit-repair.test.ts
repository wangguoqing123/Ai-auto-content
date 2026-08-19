import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadProductProfile } from '../src/product/load-product-profile.js';
import { blockingAuditIssues, runDeterministicWritingAudits, withPlagiarismAudit } from '../src/writing/audits.js';
import { loadWritingIntelligenceConfig } from '../src/writing/config.js';
import { buildSyntheticReadyResearchPack } from '../src/writing/fixture.js';
import { enumeratePublicContentUnits } from '../src/writing/public-content-units.js';
import { runWritingBuild } from '../src/writing/pipeline.js';
import { FixtureWritingProvider, type WritingProviderCall } from '../src/writing/provider.js';
import {
  applyUnitRepair,
  buildRepairPlan,
  classifyRepairability,
  type ApplyUnitRepairOptions,
  type RepairTarget,
} from '../src/writing/repair.js';
import { renderWriterOutput } from '../src/writing/render.js';
import {
  repairOutputSchema,
  writingIssueSchema,
  writingPackSchema,
  writerOutputSchema,
  type PublicContentUnit,
  type RepairOutput,
  type WriterOutput,
  type WritingIssue,
} from '../src/writing/schemas.js';
import { buildWritingStyleRecipes } from '../src/writing/style-recipe.js';
import { resolveStyleApprovalChain, resolvedWritingStyleSnapshot } from '../src/writing/style-approval-resolver.js';
import type { WritingIssue as LegacyWritingIssue } from '../src/writing-skills/types.js';
import { createStyleChainFixture, type StyleChainFixture } from './writing-test-helpers.js';

let chain: StyleChainFixture;
let base: Awaited<ReturnType<typeof setup>>;
let regressionOutput: WriterOutput;
let regressionIssues: WritingIssue[];
let regressionPlan: ReturnType<typeof buildRepairPlan>;
let regressionResult: Awaited<ReturnType<typeof runWritingBuild>>;

async function setup() {
  const styleHandle = await resolveStyleApprovalChain({ repositoryRoot: process.cwd(), researchGateAllowed: true, styleProfilePath: chain.profile, approvalReceiptPath: chain.receipt, bindingAttestationPath: chain.attestation, expectedHashes: chain.hashes });
  const research = buildSyntheticReadyResearchPack();
  const recipes = buildWritingStyleRecipes(styleHandle, 'tutorial', await loadWritingIntelligenceConfig());
  const output = (await new FixtureWritingProvider().write({ selected_style_rule_ids: recipes.selected_rule_ids, x_format: 'thread' })).output;
  return { style: resolvedWritingStyleSnapshot(styleHandle), research, product: await loadProductProfile(), recipes, output };
}

function publicIssue(unit: PublicContentUnit, issue_code = 'reversal_rhetoric', origin = 'human-writing', quote = '不是摘要，而是'): WritingIssue {
  return writingIssueSchema.parse({ issue_code, severity: 'blocking_style_issue', unit_id: unit.unit_id, surface: unit.surface, rule_origin: origin, source_commit: `${origin}-fixture`, quoted_text: quote, repair_constraint: '直接表达支持的意思。' });
}

function options(output = base.output): ApplyUnitRepairOptions {
  return {
    allowedClaimIds: new Set(base.research.verified_claims.map(({ claim_id }) => claim_id)),
    allowedExperimentRefs: new Set(base.research.experiment!.results.map(({ variant_id }) => variant_id)),
    allowedProductClaimIds: new Set(base.product.claims.confirmed),
    allowedPersonaFactIds: new Set(enumeratePublicContentUnits(output).flatMap(({ persona_fact_ids }) => persona_fact_ids)),
    allowedStyleRuleIds: new Set(base.recipes.selected_rule_ids),
  };
}

function replacement(target: RepairTarget, changes: Partial<RepairOutput['repaired_units'][number]['replacement']> = {}): RepairOutput['repaired_units'][number] {
  const unit = target.current_unit;
  return {
    unit_id: target.unit_id,
    original_sha256: target.original_sha256,
    replacement: {
      text: unit.text,
      claim_ids: unit.claim_ids,
      experiment_refs: unit.experiment_refs,
      product_claim_ids: unit.product_claim_ids,
      persona_fact_ids: unit.persona_fact_ids,
      style_rule_ids: unit.style_rule_ids,
      is_opinion: unit.is_opinion,
      ...changes,
    },
  };
}

function audit(output: WriterOutput) {
  const rendered = renderWriterOutput(output, base.research);
  return runDeterministicWritingAudits({ output, ...rendered, research: base.research, product: base.product, recipes: base.recipes, style: base.style });
}

class SurfaceRepairProvider extends FixtureWritingProvider {
  repairInput: unknown = null;
  override async write(input: unknown) {
    const call = await super.write(input);
    const output = structuredClone(call.output);
    output.abstract.text = '这不是摘要，而是一次认知升级。';
    output.x.thread.items[2]!.text = '这不是留白，而是一次方法升级。';
    return { ...call, output: writerOutputSchema.parse(output) };
  }
  override async repair(inputValue: unknown): Promise<WritingProviderCall<RepairOutput>> {
    this.calls += 1;
    this.repairInput = inputValue;
    const input = inputValue as { targets: RepairTarget[] };
    return {
      output: repairOutputSchema.parse({ repaired_units: input.targets.map((target) => replacement(target, {
        text: target.current_unit.text
          .replace('这不是摘要，而是一次认知升级。', '摘要直接说明这张执行卡怎样保留缺口。')
          .replace('这不是留白，而是一次方法升级。', '明确留白能保住未知信息，等待负责人确认。'),
      })) }),
      durationMs: 5,
      usage: null,
    };
  }
}

type ReviewerRepairMode = 'unchanged' | 'other_change' | 'remove_quote' | 'empty_quote' | 'missing_quote';
class ReviewerBlockerProvider extends FixtureWritingProvider {
  constructor(readonly mode: ReviewerRepairMode) { super(); }
  override async write(input: unknown) {
    const call = await super.write(input);
    const output = structuredClone(call.output);
    output.abstract.text = `${output.abstract.text} 这里保留待复核片段。`;
    return { ...call, output: writerOutputSchema.parse(output) };
  }
  override async review(): Promise<WritingProviderCall<{ issues: WritingIssue[] }>> {
    this.calls += 1;
    const quoted_text = this.mode === 'empty_quote' ? '' : this.mode === 'missing_quote' ? '并不存在的片段' : '待复核片段';
    return {
      output: { issues: [writingIssueSchema.parse({ issue_code: 'faux_insight', severity: 'blocking_style_issue', unit_id: 'wechat.abstract', surface: 'wechat_abstract', rule_origin: 'quality_reviewer', source_commit: 'fixture-reviewer', quoted_text, repair_constraint: '移除审阅者指出的精确片段。' })] },
      durationMs: 5,
      usage: null,
    };
  }
  override async repair(inputValue: unknown): Promise<WritingProviderCall<RepairOutput>> {
    this.calls += 1;
    const input = inputValue as { targets: RepairTarget[] };
    return {
      output: repairOutputSchema.parse({ repaired_units: input.targets.map((target) => {
        const text = this.mode === 'remove_quote'
          ? target.current_unit.text.replace('待复核片段', '待复核内容')
          : this.mode === 'other_change'
            ? `${target.current_unit.text} 已调整其他文字。`
            : target.current_unit.text;
        return replacement(target, { text });
      }) }),
      durationMs: 5,
      usage: null,
    };
  }
}

beforeAll(async () => {
  chain = await createStyleChainFixture();
  base = await setup();
  regressionOutput = (await new SurfaceRepairProvider().write({ selected_style_rule_ids: base.recipes.selected_rule_ids, x_format: 'thread' })).output;
  regressionIssues = blockingAuditIssues(audit(regressionOutput)).filter(({ issue_code }) => ['reversal_rhetoric', 'binary_contrast'].includes(issue_code));
  regressionPlan = buildRepairPlan(regressionOutput, regressionIssues);
  regressionResult = await runWritingBuild({
    rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, fixture: true, syntheticReadyFixture: true,
    styleProfilePath: chain.profile, approvalReceiptPath: chain.receipt, bindingAttestationPath: chain.attestation,
    allowProvisionalStyle: true, expectedStyleHashes: chain.hashes, provider: new SurfaceRepairProvider(), writeOutputs: false,
  });
});
afterAll(async () => chain.cleanup());

describe('Surface-aware Repair planning and contract', () => {
  it('40. preserves two Raw Issues when two Skills hit the same abstract fragment', () => {
    const abstract = regressionIssues.filter(({ unit_id }) => unit_id === 'wechat.abstract');
    expect(abstract.map(({ issue_code }) => issue_code).sort()).toEqual(['binary_contrast', 'reversal_rhetoric']);
  });

  it('41. turns those two abstract Issues into one Repair Target', () => {
    expect(regressionPlan.targets.filter(({ unit_id }) => unit_id === 'wechat.abstract')).toHaveLength(1);
  });

  it('42. turns two X-item Skill Issues into one Repair Target', () => {
    expect(regressionPlan.targets.filter(({ unit_id }) => unit_id === 'x.thread.2')).toHaveLength(1);
  });

  it('43. never merges Issues from different Units', () => {
    expect(regressionPlan.targets.map(({ unit_id }) => unit_id).sort()).toEqual(['wechat.abstract', 'x.thread.2']);
  });

  it('44. deduplicates repeated constraints inside one Target', () => {
    const unit = enumeratePublicContentUnits(base.output).find(({ unit_id }) => unit_id === 'wechat.abstract')!;
    const duplicated = publicIssue(unit);
    const plan = buildRepairPlan(base.output, [duplicated, duplicated]);
    expect(plan.targets[0]!.constraints).toHaveLength(1);
  });

  it('45. aggregates different Issues on one Unit into one Target', () => {
    const unit = enumeratePublicContentUnits(base.output).find(({ unit_id }) => unit_id === 'wechat.abstract')!;
    const plan = buildRepairPlan(base.output, [publicIssue(unit), publicIssue(unit, 'faux_insight', 'human-writing', '真正的关键')]);
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]!.issue_codes).toEqual(expect.arrayContaining(['reversal_rhetoric', 'faux_insight']));
  });

  it('46. allows a scoped Repair to modify wechat.abstract', () => {
    const target = regressionPlan.targets.find(({ unit_id }) => unit_id === 'wechat.abstract')!;
    const next = applyUnitRepair(regressionOutput, [target], { repaired_units: [replacement(target, { text: '新的合规摘要。' })] }, options(regressionOutput));
    expect(next.abstract.text).toBe('新的合规摘要。');
  });

  it('47. allows a scoped Repair to modify x.thread.2', () => {
    const target = regressionPlan.targets.find(({ unit_id }) => unit_id === 'x.thread.2')!;
    const next = applyUnitRepair(regressionOutput, [target], { repaired_units: [replacement(target, { text: '新的第三条 X。' })] }, options(regressionOutput));
    expect(next.x.thread.items[2]!.text).toBe('新的第三条 X。');
  });

  it('48. still allows a scoped Repair to modify a Content Block', () => {
    const unit = enumeratePublicContentUnits(base.output).find(({ unit_id }) => unit_id === 'wechat.block.block_cta')!;
    const plan = buildRepairPlan(base.output, [publicIssue(unit)]);
    const target = plan.targets[0]!;
    const next = applyUnitRepair(base.output, [target], { repaired_units: [replacement(target, { text: '新的 Block 文本。' })] }, options());
    expect(next.blocks.find(({ block_id }) => block_id === 'block_cta')!.text).toBe('新的 Block 文本。');
  });

  it('49. rejects a patch for an untargeted title', () => {
    const target = regressionPlan.targets[0]!;
    const title = enumeratePublicContentUnits(regressionOutput).find(({ unit_id }) => unit_id === 'wechat.primary_title')!;
    expect(() => applyUnitRepair(regressionOutput, [target], { repaired_units: [{ ...replacement(target), unit_id: title.unit_id }] }, options(regressionOutput))).toThrow('writing_output_invalid');
  });

  it('50. locks the X format during Unit Repair', () => {
    const target = regressionPlan.targets.find(({ unit_id }) => unit_id === 'x.thread.2')!;
    const next = applyUnitRepair(regressionOutput, [target], { repaired_units: [replacement(target, { text: '修复后的 X。' })] }, options(regressionOutput));
    expect(next.x.format).toBe(regressionOutput.x.format);
  });

  it('51. locks the X thread count during Unit Repair', () => {
    const target = regressionPlan.targets.find(({ unit_id }) => unit_id === 'x.thread.2')!;
    const next = applyUnitRepair(regressionOutput, [target], { repaired_units: [replacement(target, { text: '修复后的 X。' })] }, options(regressionOutput));
    expect(next.x.thread.items).toHaveLength(regressionOutput.x.thread.items.length);
  });

  it('52. cannot add a new Unit', () => {
    const target = regressionPlan.targets[0]!;
    expect(() => applyUnitRepair(regressionOutput, [target], { repaired_units: [{ ...replacement(target), unit_id: 'wechat.block.block_new' }] }, options(regressionOutput))).toThrow('writing_output_invalid');
  });

  it('53. rejects Repair output that omits every required Target', () => {
    expect(() => applyUnitRepair(regressionOutput, regressionPlan.targets, { repaired_units: [] }, options(regressionOutput))).toThrow('writing_output_invalid');
  });

  it('54. rejects an original_sha256 mismatch', () => {
    const target = regressionPlan.targets[0]!;
    expect(() => applyUnitRepair(regressionOutput, [target], { repaired_units: [{ ...replacement(target), original_sha256: 'a'.repeat(64) }] }, options(regressionOutput))).toThrow('writing_output_invalid');
  });

  it('55. rejects duplicate patches for one unit_id', () => {
    const target = regressionPlan.targets[0]!;
    const item = replacement(target);
    expect(() => applyUnitRepair(regressionOutput, [target], { repaired_units: [item, item] }, options(regressionOutput))).toThrow('writing_output_invalid');
  });

  it('56. rejects a field change that is absent from allowed_fields', () => {
    const target = regressionPlan.targets[0]!;
    expect(target.allowed_fields).toEqual(['text']);
    expect(() => applyUnitRepair(regressionOutput, [target], { repaired_units: [replacement(target, { claim_ids: [] })] }, options(regressionOutput))).toThrow('writing_output_invalid');
  });

  it('57. limits a pure Style Issue to text', () => {
    expect(classifyRepairability(regressionIssues[0]!)).toEqual({ repairability: 'text_patch', allowed_fields: ['text'] });
  });

  it('58. allows an Evidence Issue to patch text, claim_ids, and is_opinion', () => {
    const unit = enumeratePublicContentUnits(base.output).find(({ unit_id }) => unit_id === 'wechat.abstract')!;
    const evidence = writingIssueSchema.parse({ ...publicIssue(unit), issue_code: 'factual_unit_without_claim', rule_origin: 'project' });
    expect(classifyRepairability(evidence)).toEqual({ repairability: 'metadata_patch', allowed_fields: ['text', 'claim_ids', 'is_opinion'] });
  });

  it('59. rejects a newly invented Claim ID', () => {
    const unit = enumeratePublicContentUnits(base.output).find(({ unit_id }) => unit_id === 'wechat.abstract')!;
    const plan = buildRepairPlan(base.output, [writingIssueSchema.parse({ ...publicIssue(unit), issue_code: 'factual_unit_without_claim', rule_origin: 'project' })]);
    const target = plan.targets[0]!;
    expect(() => applyUnitRepair(base.output, [target], { repaired_units: [replacement(target, { claim_ids: ['claim_invented'] })] }, options())).toThrow('writing_output_invalid');
  });

  it('60. rejects a newly invented experiment reference', () => {
    const unit = enumeratePublicContentUnits(base.output).find(({ unit_id }) => unit_id === 'wechat.abstract')!;
    const plan = buildRepairPlan(base.output, [writingIssueSchema.parse({ ...publicIssue(unit), issue_code: 'experiment_overclaim', rule_origin: 'project' })]);
    const target = plan.targets[0]!;
    expect(() => applyUnitRepair(base.output, [target], { repaired_units: [replacement(target, { experiment_refs: ['baseline_chat_request'] })] }, { ...options(), allowedExperimentRefs: new Set() })).toThrow('writing_output_invalid');
  });

  it('61. rejects a newly invented product Claim ID', () => {
    const unit = enumeratePublicContentUnits(base.output).find(({ unit_id }) => unit_id === 'wechat.abstract')!;
    const plan = buildRepairPlan(base.output, [writingIssueSchema.parse({ ...publicIssue(unit), issue_code: 'forbidden_product_claim', rule_origin: 'project' })]);
    const target = plan.targets[0]!;
    expect(() => applyUnitRepair(base.output, [target], { repaired_units: [replacement(target, { product_claim_ids: ['product.invented'] })] }, options())).toThrow('writing_output_invalid');
  });

  it('62. rejects a newly invented persona fact ID', () => {
    const unit = enumeratePublicContentUnits(base.output).find(({ unit_id }) => unit_id === 'wechat.abstract')!;
    const plan = buildRepairPlan(base.output, [writingIssueSchema.parse({ ...publicIssue(unit), issue_code: 'unsupported_first_person_fact', rule_origin: 'project' })]);
    const target = plan.targets[0]!;
    expect(() => applyUnitRepair(base.output, [target], { repaired_units: [replacement(target, { persona_fact_ids: ['persona.invented'] })] }, options())).toThrow('writing_output_invalid');
  });

  it('63. keeps style_rule_ids immutable for a Style-only Target', () => {
    const target = regressionPlan.targets[0]!;
    expect(() => applyUnitRepair(regressionOutput, [target], { repaired_units: [replacement(target, { style_rule_ids: [] })] }, options(regressionOutput))).toThrow('writing_output_invalid');
  });

  it('64. classifies x_format_mismatch as a non-repairable contract issue', () => {
    const issue = writingIssueSchema.parse({ issue_code: 'x_format_mismatch', severity: 'hard_blocker', unit_id: 'writing.contract', surface: 'writing_contract', rule_origin: 'project', source_commit: 'project-v0', quoted_text: 'thread', repair_constraint: 'Use planned format.' });
    expect(classifyRepairability(issue).repairability).toBe('non_repairable_contract');
  });

  it('65. classifies article_type_mismatch as non-repairable', () => {
    const issue = writingIssueSchema.parse({ issue_code: 'article_type_mismatch', severity: 'hard_blocker', unit_id: 'writing.contract', surface: 'writing_contract', rule_origin: 'project', source_commit: 'project-v0', quoted_text: 'analysis', repair_constraint: 'Use planned type.' });
    expect(classifyRepairability(issue).repairability).toBe('non_repairable_contract');
  });

  it('66. keeps unknown Claim IDs out of ordinary text Repair', () => {
    const unit = enumeratePublicContentUnits(base.output)[0]!;
    expect(classifyRepairability(writingIssueSchema.parse({ ...publicIssue(unit), issue_code: 'unknown_claim_id' })).repairability).toBe('non_repairable_contract');
  });

  it('67. keeps closed Style Rules out of ordinary text Repair', () => {
    const unit = enumeratePublicContentUnits(base.output)[0]!;
    expect(classifyRepairability(writingIssueSchema.parse({ ...publicIssue(unit), issue_code: 'closed_style_rule_used' })).repairability).toBe('non_repairable_contract');
  });

  it('68. does not call Repair when a non-repairable issue exists', async () => {
    const issue = writingIssueSchema.parse({ issue_code: 'x_format_mismatch', severity: 'hard_blocker', unit_id: 'writing.contract', surface: 'writing_contract', rule_origin: 'quality_reviewer', source_commit: 'fixture', quoted_text: 'thread', repair_constraint: 'Use planned format.' });
    const provider = new FixtureWritingProvider([issue]);
    const result = await runWritingBuild({ rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, fixture: true, syntheticReadyFixture: true, styleProfilePath: chain.profile, approvalReceiptPath: chain.receipt, bindingAttestationPath: chain.attestation, allowProvisionalStyle: true, expectedStyleHashes: chain.hashes, provider, writeOutputs: false });
    expect(provider.calls).toBe(2);
    expect(result.pack.error_code).toBe('writing_output_invalid');
    expect(result.diagnostics).toMatchObject({ repair_executed: false, blocking_issues: [expect.objectContaining({ issue_code: 'x_format_mismatch', unit_id: 'writing.contract' })] });
  });

  it('69. reproduces exactly four Raw cross-Skill Issues from the second live failure shape', () => {
    expect(regressionIssues.map(({ issue_code }) => issue_code).sort()).toEqual(['binary_contrast', 'binary_contrast', 'reversal_rhetoric', 'reversal_rhetoric']);
  });

  it('70. builds exactly two surface Repair Targets for that regression', () => {
    expect(regressionPlan.targets.map(({ unit_id }) => unit_id).sort()).toEqual(['wechat.abstract', 'x.thread.2']);
  });

  it('71. repairs both failed surfaces in one Repair call', () => {
    expect(regressionResult.diagnostics).toMatchObject({ repair_executed: true, repair_target_count: 2 });
    expect(regressionResult.pack.model.calls).toBe(3);
  });

  it('72. reaches a passing final Style Audit after the one Repair', () => {
    expect(regressionResult.pack.audits?.style.status).toBe('pass');
  });

  it('73. actually runs the final Plagiarism Guard in the regression Fixture', () => {
    expect(regressionResult.diagnostics?.plagiarism_guard_executed).toBe(true);
    expect(regressionResult.pack.audits?.plagiarism.status).toBe('pass');
  });

  it('74. produces READY_FOR_HUMAN_REVIEW for the repaired regression Fixture', () => {
    expect(regressionResult.pack).toMatchObject({ status: 'success', decision: 'READY_FOR_HUMAN_REVIEW', model: { calls: 3 } });
  });

  it('75. represents an unexecuted Guard as not_run with null detections', () => {
    const initial = audit(regressionOutput);
    expect(initial.plagiarism).toMatchObject({ status: 'not_run', protected_transfer_detected: null, reference_overlap_detected: null });
  });

  it('76. represents a passing Guard as pass with false detections', () => {
    expect(regressionResult.pack.audits?.plagiarism).toMatchObject({ status: 'pass', protected_transfer_detected: false, reference_overlap_detected: false });
  });

  it('77. represents a blocked Protected Transfer Guard accurately', () => {
    const legacy: LegacyWritingIssue = { issue_code: 'signature_phrase_transfer', pattern: 'signature', quoted_text: 'redacted', location: 'draft', severity: 'hard_blocker', repair_constraint: 'remove', rule_origin: 'plagiarism_guard', source_commit: 'project-v0' };
    expect(withPlagiarismAudit(audit(base.output), { status: 'blocked', issues: [legacy] }).plagiarism).toMatchObject({ status: 'blocked', protected_transfer_detected: true, reference_overlap_detected: false });
  });

  it('78. rejects READY_FOR_HUMAN_REVIEW when plagiarism remains not_run', () => {
    const pack = structuredClone(regressionResult.pack);
    pack.audits!.plagiarism = { status: 'not_run', issues: [], checked_items: ['not run'], protected_transfer_detected: null, reference_overlap_detected: null };
    expect(writingPackSchema.safeParse(pack).success).toBe(false);
  });

  it('79. sends Repair no Protected Entry or Reference Raw Corpus', () => {
    const provider = new SurfaceRepairProvider();
    return runWritingBuild({ rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, fixture: true, syntheticReadyFixture: true, styleProfilePath: chain.profile, approvalReceiptPath: chain.receipt, bindingAttestationPath: chain.attestation, allowProvisionalStyle: true, expectedStyleHashes: chain.hashes, provider, writeOutputs: false }).then(() => {
      const serialized = JSON.stringify(provider.repairInput);
      expect(serialized).not.toMatch(/protected_entry|reference_corpus|raw_corpus|blind-map/iu);
    });
  });

  it('80. preserves the maximum of three Provider calls', () => {
    expect(regressionResult.pack.model.calls).toBe(3);
  });

  it('81. reports the exact missing unit_id when one of two Targets is omitted', () => {
    const returned = replacement(regressionPlan.targets[0]!, { text: '已修改第一个 Target。' });
    try {
      applyUnitRepair(regressionOutput, regressionPlan.targets, { repaired_units: [returned] }, options(regressionOutput));
      throw new Error('expected RepairContractError');
    } catch (error) {
      expect(error).toMatchObject({ code: 'writing_output_invalid', reason: `repair_target_missing:${regressionPlan.targets[1]!.unit_id}` });
    }
  });

  it('82. rejects a complete Target whose replacement is unchanged', () => {
    const target = regressionPlan.targets[0]!;
    try {
      applyUnitRepair(regressionOutput, [target], { repaired_units: [replacement(target)] }, options(regressionOutput));
      throw new Error('expected RepairContractError');
    } catch (error) {
      expect(error).toMatchObject({ code: 'writing_output_invalid', reason: `repair_target_unchanged:${target.unit_id}` });
    }
  });

  it('83. fails when a Reviewer blocker receives an unchanged Repair', async () => {
    const provider = new ReviewerBlockerProvider('unchanged');
    const result = await runWithProvider(provider);
    expect(result.pack).toMatchObject({ status: 'failed', decision: null, error_code: 'writing_output_invalid', model: { calls: 3 } });
    expect(result.pack.error_message_safe).toContain('repair_target_unchanged:wechat.abstract');
    expect(result.diagnostics).toMatchObject({ repair_executed: true, plagiarism_guard_executed: false, audit_statuses: { plagiarism: 'not_run' } });
  });

  it('84. preserves a Reviewer blocker when other text changes but quoted_text remains', async () => {
    const provider = new ReviewerBlockerProvider('other_change');
    const result = await runWithProvider(provider);
    expect(result.pack).toMatchObject({ status: 'failed', decision: null, error_code: 'writing_audit_failed', model: { calls: 3 } });
    expect(result.diagnostics).toMatchObject({ repair_executed: true, plagiarism_guard_executed: false, blocking_issues: [expect.objectContaining({ issue_code: 'faux_insight', unit_id: 'wechat.abstract' })] });
  });

  it('85. fails closed before Repair when Reviewer quoted_text is empty', async () => {
    const provider = new ReviewerBlockerProvider('empty_quote');
    const result = await runWithProvider(provider);
    expect(provider.calls).toBe(2);
    expect(result.pack).toMatchObject({ status: 'failed', decision: null, error_code: 'writing_output_invalid' });
    expect(result.pack.error_message_safe).toContain('reviewer_quoted_text_empty:wechat.abstract');
    expect(result.diagnostics).toMatchObject({ repair_executed: false, plagiarism_guard_executed: false });
  });

  it('86. fails closed before Repair when Reviewer quoted_text is not in the Unit', async () => {
    const provider = new ReviewerBlockerProvider('missing_quote');
    const result = await runWithProvider(provider);
    expect(provider.calls).toBe(2);
    expect(result.pack).toMatchObject({ status: 'failed', decision: null, error_code: 'writing_output_invalid' });
    expect(result.pack.error_message_safe).toContain('reviewer_quote_not_found:wechat.abstract');
    expect(result.diagnostics?.plagiarism_guard_executed).toBe(false);
  });

  it('87. discharges a Reviewer blocker only after exact quoted_text removal', async () => {
    const provider = new ReviewerBlockerProvider('remove_quote');
    const result = await runWithProvider(provider);
    expect(result.pack).toMatchObject({ status: 'success', decision: 'READY_FOR_HUMAN_REVIEW', model: { calls: 3 }, audits: { style: { status: 'pass' }, plagiarism: { status: 'pass' } } });
    expect(result.diagnostics).toMatchObject({ repair_executed: true, repair_target_count: 1, plagiarism_guard_executed: true, blocking_issues: [] });
  });

  it('88. does not add a fourth Reviewer after successful blocker discharge', async () => {
    const provider = new ReviewerBlockerProvider('remove_quote');
    const result = await runWithProvider(provider);
    expect(provider.calls).toBe(3);
    expect(result.pack.model.calls).toBe(3);
  });
});

function runWithProvider(provider: FixtureWritingProvider) {
  return runWritingBuild({
    rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, fixture: true, syntheticReadyFixture: true,
    styleProfilePath: chain.profile, approvalReceiptPath: chain.receipt, bindingAttestationPath: chain.attestation,
    allowProvisionalStyle: true, expectedStyleHashes: chain.hashes, provider, writeOutputs: false,
  });
}
