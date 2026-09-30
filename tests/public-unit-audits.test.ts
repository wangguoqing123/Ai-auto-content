import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadProductProfile } from '../src/product/load-product-profile.js';
import { blockingAuditIssues, runDeterministicWritingAudits } from '../src/writing/audits.js';
import { loadWritingIntelligenceConfig } from '../src/writing/config.js';
import { buildSyntheticReadyResearchPack } from '../src/writing/fixture.js';
import { applyPublicContentUnitPatches, enumeratePublicContentUnits } from '../src/writing/public-content-units.js';
import { FixtureWritingProvider } from '../src/writing/provider.js';
import { renderWriterOutput } from '../src/writing/render.js';
import { buildWritingStyleRecipes } from '../src/writing/style-recipe.js';
import { resolveStyleApprovalChain, resolvedWritingStyleSnapshot } from '../src/writing/style-approval-resolver.js';
import type { PublicContentUnit, WriterOutput } from '../src/writing/schemas.js';
import { createStyleChainFixture, type StyleChainFixture } from './writing-test-helpers.js';

let chain: StyleChainFixture;
let base: Awaited<ReturnType<typeof setup>>;

async function setup() {
  const style = await resolveStyleApprovalChain({ repositoryRoot: process.cwd(), researchGateAllowed: true, styleProfilePath: chain.profile, approvalReceiptPath: chain.receipt, bindingAttestationPath: chain.attestation, expectedHashes: chain.hashes });
  const research = buildSyntheticReadyResearchPack();
  const recipes = buildWritingStyleRecipes(style, 'tutorial', await loadWritingIntelligenceConfig());
  const output = (await new FixtureWritingProvider().write({ selected_style_rule_ids: recipes.selected_rule_ids, x_format: 'thread' })).output;
  return { style: resolvedWritingStyleSnapshot(style), research, product: await loadProductProfile(), recipes, output };
}

beforeAll(async () => { chain = await createStyleChainFixture(); base = await setup(); });
afterAll(async () => chain.cleanup());

function patch(output: WriterOutput, unitId: string, changes: Partial<PublicContentUnit>): WriterOutput {
  const unit = enumeratePublicContentUnits(output).find(({ unit_id }) => unit_id === unitId)!;
  return applyPublicContentUnitPatches(output, [{ ...unit, ...changes }]);
}

function audit(output: WriterOutput, research = base.research) {
  const rendered = renderWriterOutput(output, research);
  return runDeterministicWritingAudits({ output, ...rendered, research, product: base.product, recipes: base.recipes, style: base.style });
}

describe('Public-surface deterministic Audits', () => {
  it('18. passes every deterministic Audit for the complete Fixture Units', () => {
    const result = audit(base.output);
    expect([result.evidence.status, result.experiment.status, result.product.status, result.first_person.status, result.style.status]).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
  });

  it('19. blocks an unevidenced factual abstract', () => {
    const output = patch(base.output, 'wechat.abstract', { claim_ids: [], is_opinion: false });
    expect(blockingAuditIssues(audit(output))).toContainEqual(expect.objectContaining({ issue_code: 'factual_unit_without_claim', unit_id: 'wechat.abstract', surface: 'wechat_abstract' }));
  });

  it('20. blocks an unevidenced factual X item', () => {
    const output = patch(base.output, 'x.thread.1', { claim_ids: [], is_opinion: false });
    expect(blockingAuditIssues(audit(output))).toContainEqual(expect.objectContaining({ issue_code: 'factual_unit_without_claim', unit_id: 'x.thread.1' }));
  });

  it('21. blocks a partial Claim in the primary title', () => {
    const research = structuredClone(base.research);
    research.verified_claims[0] = { ...research.verified_claims[0]!, support_status: 'partial', scope_limit: '只限当前合成样例。' };
    expect(blockingAuditIssues(audit(base.output, research))).toContainEqual(expect.objectContaining({ issue_code: 'partial_claim_in_title', unit_id: 'wechat.primary_title' }));
  });

  it('22. blocks a partial Claim in an alternative title', () => {
    const research = structuredClone(base.research);
    research.verified_claims[1] = { ...research.verified_claims[1]!, support_status: 'partial', scope_limit: '只限当前合成样例。' };
    expect(blockingAuditIssues(audit(base.output, research))).toContainEqual(expect.objectContaining({ issue_code: 'partial_claim_in_title', unit_id: 'wechat.alternative_title.0' }));
  });

  it('23. blocks an X “我实测” statement without persona evidence', () => {
    const output = patch(base.output, 'x.thread.2', { text: '我实测这个方法一定有效。', persona_fact_ids: [], is_opinion: false });
    expect(blockingAuditIssues(audit(output))).toContainEqual(expect.objectContaining({ issue_code: 'unsupported_first_person_fact', unit_id: 'x.thread.2' }));
  });

  it('24. blocks an abstract “我最近用了” statement', () => {
    const output = patch(base.output, 'wechat.abstract', { text: '我最近用了这个方法，结果很好。', persona_fact_ids: [], is_opinion: false });
    expect(blockingAuditIssues(audit(output))).toContainEqual(expect.objectContaining({ issue_code: 'unsupported_first_person_fact', unit_id: 'wechat.abstract' }));
  });

  it('25. blocks a factual first-person title', () => {
    const output = patch(base.output, 'wechat.primary_title', { text: '我实测过的会议执行卡', persona_fact_ids: [], is_opinion: false });
    expect(blockingAuditIssues(audit(output))).toContainEqual(expect.objectContaining({ issue_code: 'unsupported_first_person_fact', unit_id: 'wechat.primary_title' }));
  });

  it('26. blocks unbound product language in the abstract', () => {
    const output = patch(base.output, 'wechat.abstract', { text: '会员还可以获得固定答疑频率权益。', product_claim_ids: [] });
    const codes = blockingAuditIssues(audit(output)).filter(({ unit_id }) => unit_id === 'wechat.abstract').map(({ issue_code }) => issue_code);
    expect(codes).toEqual(expect.arrayContaining(['product_claim_without_id', 'forbidden_product_claim']));
  });

  it('27. blocks unbound product language in X', () => {
    const output = patch(base.output, 'x.thread.0', { text: '报名俱乐部即可获得这些课程权益。', product_claim_ids: [] });
    expect(blockingAuditIssues(audit(output))).toContainEqual(expect.objectContaining({ issue_code: 'product_claim_without_id', unit_id: 'x.thread.0' }));
  });

  it('28. blocks experiment extrapolation in X even with an experiment ref', () => {
    const output = patch(base.output, 'x.thread.2', { text: '实验已经证明效率提升 50%。', experiment_refs: ['baseline_chat_request'] });
    const codes = blockingAuditIssues(audit(output)).filter(({ unit_id }) => unit_id === 'x.thread.2').map(({ issue_code }) => issue_code);
    expect(codes).toEqual(expect.arrayContaining(['experiment_overclaim', 'unverified_percentage']));
  });

  it('29. blocks an experiment conclusion in the abstract without experiment_refs', () => {
    const output = patch(base.output, 'wechat.abstract', { text: '实验结果显示通过 8 项验收。', experiment_refs: [] });
    expect(blockingAuditIssues(audit(output))).toContainEqual(expect.objectContaining({ issue_code: 'experiment_reference_missing', unit_id: 'wechat.abstract' }));
  });

  it('30. blocks an unknown Claim ID on X', () => {
    const output = patch(base.output, 'x.thread.1', { claim_ids: ['claim_unknown'] });
    expect(blockingAuditIssues(audit(output))).toContainEqual(expect.objectContaining({ issue_code: 'unknown_claim_id', unit_id: 'x.thread.1' }));
  });

  it('31. requires a partial X Claim to retain its scope_limit', () => {
    const research = structuredClone(base.research);
    research.verified_claims[0] = { ...research.verified_claims[0]!, support_status: 'partial', scope_limit: '只限当前合成样例。' };
    expect(blockingAuditIssues(audit(base.output, research))).toContainEqual(expect.objectContaining({ issue_code: 'partial_claim_overstated', unit_id: 'x.thread.0' }));
  });

  it('32. runs both Style linters independently on the abstract', () => {
    const output = patch(base.output, 'wechat.abstract', { text: '这不是摘要，而是一次认知升级。' });
    const issues = audit(output).style.issues.filter(({ unit_id }) => unit_id === 'wechat.abstract');
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ issue_code: 'reversal_rhetoric', rule_origin: 'human-writing' }),
      expect.objectContaining({ issue_code: 'binary_contrast', rule_origin: 'no-ai-slop' }),
    ]));
  });

  it('33. runs Style Lint on every X item with stable Unit locations', () => {
    const output = patch(base.output, 'x.thread.2', { text: '先说结论：这不是留白，而是升级。' });
    const issues = audit(output).style.issues.filter(({ unit_id }) => unit_id === 'x.thread.2');
    expect(issues.length).toBeGreaterThan(1);
    expect(issues.every(({ surface }) => surface === 'x_thread_item')).toBe(true);
  });

  it('34. includes full audit provenance on every Issue', () => {
    const output = patch(base.output, 'wechat.abstract', { text: '先说结论：可以执行。' });
    for (const item of audit(output).style.issues) expect(item).toEqual(expect.objectContaining({ unit_id: expect.any(String), surface: expect.any(String), rule_origin: expect.any(String), source_commit: expect.any(String) }));
  });

  it('35. targets missing required disclosures to the boundary Unit', () => {
    const research = structuredClone(base.research);
    research.writing_requirements.required_disclosures.push('必须新增但当前缺失的披露。');
    expect(blockingAuditIssues(audit(base.output, research))).toContainEqual(expect.objectContaining({ issue_code: 'required_disclosure_missing', unit_id: 'wechat.block.block_limitations' }));
  });

  it('36. targets missing experiment limitations to the boundary Unit', () => {
    const research = structuredClone(base.research);
    research.experiment!.limitations.push('新的实验限制必须保留。');
    expect(blockingAuditIssues(audit(base.output, research))).toContainEqual(expect.objectContaining({ issue_code: 'experiment_limitation_missing', unit_id: 'wechat.block.block_limitations' }));
  });

  it('37. does not audit a second rendered copy of the same Block', () => {
    const output = writerOutputSchemaForTest(patch(base.output, 'wechat.block.block_hook', { text: '先说结论：只检查一次。' }));
    const issues = audit(output).style.issues.filter(({ unit_id, issue_code }) => unit_id === 'wechat.block.block_hook' && issue_code === 'throat_clearing');
    expect(issues).toHaveLength(1);
  });

  it('38. initializes the plagiarism Audit as not_run with null detections', () => {
    expect(audit(base.output).plagiarism).toMatchObject({ status: 'not_run', protected_transfer_detected: null, reference_overlap_detected: null });
  });

  it('39. gives titles, abstract, CTA, and X the same evidence metadata shape', () => {
    const units = enumeratePublicContentUnits(base.output).filter(({ surface }) => surface !== 'wechat_block');
    for (const unit of units) expect(unit).toEqual(expect.objectContaining({ claim_ids: expect.any(Array), experiment_refs: expect.any(Array), product_claim_ids: expect.any(Array), persona_fact_ids: expect.any(Array), style_rule_ids: expect.any(Array), is_opinion: expect.any(Boolean) }));
  });

  it('39a. allows neutral collective instructional “我们” language', () => {
    const output = patch(base.output, 'wechat.abstract', { text: '我们先提取字段，再逐项验收。', is_opinion: false, persona_fact_ids: [] });
    expect(audit(output).first_person).toMatchObject({ status: 'pass', issues: [], sentences: [] });
  });

  it('39b. blocks collective factual experience without persona evidence', () => {
    const output = patch(base.output, 'wechat.abstract', { text: '我们实测这个方法有效。', is_opinion: false, persona_fact_ids: [] });
    expect(blockingAuditIssues(audit(output))).toContainEqual(expect.objectContaining({ issue_code: 'unsupported_first_person_fact', unit_id: 'wechat.abstract' }));
  });

  it('39c. requires collective judgment to be marked as opinion', () => {
    const unmarked = patch(base.output, 'wechat.abstract', { text: '我们认为先保留缺口更稳妥。', is_opinion: false, persona_fact_ids: [] });
    const marked = patch(base.output, 'wechat.abstract', { text: '我们认为先保留缺口更稳妥。', is_opinion: true, persona_fact_ids: [] });
    expect(blockingAuditIssues(audit(unmarked))).toContainEqual(expect.objectContaining({ issue_code: 'unmarked_first_person_opinion', unit_id: 'wechat.abstract' }));
    expect(audit(marked).first_person.status).toBe('pass');
  });

  it('39d. preserves singular first-person fact and opinion boundaries', () => {
    const factual = patch(base.output, 'wechat.abstract', { text: '我实测这个方法有效。', is_opinion: false, persona_fact_ids: [] });
    const unmarkedOpinion = patch(base.output, 'wechat.abstract', { text: '我的判断是先保留缺口。', is_opinion: false, persona_fact_ids: [] });
    const markedOpinion = patch(base.output, 'wechat.abstract', { text: '我的判断是先保留缺口。', is_opinion: true, persona_fact_ids: [] });
    expect(blockingAuditIssues(audit(factual))).toContainEqual(expect.objectContaining({ issue_code: 'unsupported_first_person_fact' }));
    expect(blockingAuditIssues(audit(unmarkedOpinion))).toContainEqual(expect.objectContaining({ issue_code: 'unmarked_first_person_opinion' }));
    expect(audit(markedOpinion).first_person.status).toBe('pass');
  });
});

function writerOutputSchemaForTest(output: WriterOutput): WriterOutput { return output; }
