import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStyleFixtureDocuments } from '../src/style-intelligence/fixture.js';
import { buildProtectedTransferIndex, resolveFixtureProtectedTransferIndexes } from '../src/style-intelligence/protected-transfer.js';
import { adaptHumanWriting } from '../src/writing-skills/human-writing-adapter.js';
import { adaptNoAiSlopReview } from '../src/writing-skills/no-ai-slop-adapter.js';
import { guardAgainstPlagiarism } from '../src/writing-lint/plagiarism-guard.js';
import { resolveAuthorizedResearchQuotes } from '../src/writing-lint/authorized-research-quotes.js';
import { blockingAuditIssues, runDeterministicWritingAudits } from '../src/writing/audits.js';
import { buildSyntheticReadyResearchPack } from '../src/writing/fixture.js';
import { runWritingBuild } from '../src/writing/pipeline.js';
import { applyUnitRepair, buildRepairPlan } from '../src/writing/repair.js';
import { FixtureWritingProvider } from '../src/writing/provider.js';
import { renderWriterOutput } from '../src/writing/render.js';
import { loadWritingIntelligenceConfig } from '../src/writing/config.js';
import { buildWritingStyleRecipes } from '../src/writing/style-recipe.js';
import { resolveStyleApprovalChain, resolvedWritingStyleSnapshot } from '../src/writing/style-approval-resolver.js';
import { reviewerOutputSchema, writerOutputSchema, writingIssueSchema } from '../src/writing/schemas.js';
import { toJSONSchema } from 'zod';
import { loadProductProfile } from '../src/product/load-product-profile.js';
import { createStyleChainFixture, type StyleChainFixture } from './writing-test-helpers.js';

let chainFixture: StyleChainFixture;
let stylePaths: { styleProfilePath: string; approvalReceiptPath: string; bindingAttestationPath: string };
const pipelineStyle = () => ({ ...stylePaths, expectedStyleHashes: chainFixture.hashes, allowProvisionalStyle: true as const });

let context: Awaited<ReturnType<typeof makeContext>>;
async function makeContext() {
  const style = await resolveStyleApprovalChain({ repositoryRoot: process.cwd(), researchGateAllowed: true, ...stylePaths, expectedHashes: chainFixture.hashes });
  const research = buildSyntheticReadyResearchPack();
  const recipes = buildWritingStyleRecipes(style, 'tutorial', await loadWritingIntelligenceConfig());
  const output = (await new FixtureWritingProvider().write({ selected_style_rule_ids: recipes.selected_rule_ids, x_format: 'thread' })).output;
  const rendered = renderWriterOutput(output, research);
  return { style, snapshot: resolvedWritingStyleSnapshot(style), research, product: await loadProductProfile(), recipes, output, rendered };
}
function reviewIssue(severity: 'hard_blocker' | 'blocking_style_issue' = 'blocking_style_issue') {
  return writingIssueSchema.parse({ issue_code: 'reversal_rhetoric', severity, unit_id: 'wechat.block.block_cta', surface: 'wechat_block', rule_origin: 'quality_reviewer', source_commit: 'fixture-reviewer', quoted_text: '最小结果', repair_constraint: 'remove repetition' });
}
beforeAll(async () => {
  chainFixture = await createStyleChainFixture();
  stylePaths = { styleProfilePath: chainFixture.profile, approvalReceiptPath: chainFixture.receipt, bindingAttestationPath: chainFixture.attestation };
  context = await makeContext();
});
afterAll(async () => chainFixture.cleanup());

describe('Writing orchestration and safety', () => {
  it('56. loads human-writing revision rules only after the first draft', () => {
    const pre = adaptHumanWriting({ article_type: 'tutorial', material_count: 8, factual_mode: 'nonfiction' }, 'pre_draft');
    const post = adaptHumanWriting({ article_type: 'tutorial', material_count: 8, factual_mode: 'nonfiction' }, 'post_draft');
    expect(pre.revision_rules).toEqual([]); expect(post.revision_rules.length).toBeGreaterThan(0);
  });

  it('57. keeps no-ai-slop in detect-only mode', () => {
    expect(adaptNoAiSlopReview([])).toMatchObject({ mode: 'detect_only', permits_full_text_rewrite: false, permits_new_facts_examples_or_opinions: false });
  });

  it('58. rejects a Reviewer response that contains a full rewrite', () => {
    expect(reviewerOutputSchema.safeParse({ issues: [], rewritten_text: 'full rewrite' }).success).toBe(false);
  });

  it('59. applies Repair only to explicitly targeted Blocks', () => {
    const plan = buildRepairPlan(context.output, [reviewIssue()]);
    const target = plan.targets[0]!;
    const changed = applyUnitRepair(context.output, plan.targets, { repaired_units: [{ unit_id: target.unit_id, original_sha256: target.original_sha256, replacement: { text: '保留一个可验证动作。', claim_ids: target.current_unit.claim_ids, experiment_refs: target.current_unit.experiment_refs, product_claim_ids: target.current_unit.product_claim_ids, persona_fact_ids: target.current_unit.persona_fact_ids, style_rule_ids: target.current_unit.style_rule_ids, is_opinion: target.current_unit.is_opinion } }] }, {
      allowedClaimIds: new Set(context.research.verified_claims.map(({ claim_id }) => claim_id)), allowedExperimentRefs: new Set(context.research.experiment!.results.map(({ variant_id }) => variant_id)),
      allowedProductClaimIds: new Set(context.product.claims.confirmed), allowedPersonaFactIds: new Set(), allowedStyleRuleIds: new Set(context.recipes.selected_rule_ids),
    });
    expect(changed.blocks.find(({ block_id }) => block_id === 'block_cta')?.text).toBe('保留一个可验证动作。');
    expect(changed.blocks.find(({ block_id }) => block_id === 'block_hook')?.text).toBe(context.output.blocks.find(({ block_id }) => block_id === 'block_hook')?.text);
  });

  it('60. caps a blocking-review flow at three model calls', async () => {
    const provider = new FixtureWritingProvider([reviewIssue()]);
    const result = await runWritingBuild({ rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, fixture: true, syntheticReadyFixture: true, ...pipelineStyle(), provider, writeOutputs: false });
    expect(result.pack.model.calls).toBe(3); expect(provider.calls).toBe(3);
  });

  it('61. never performs a fourth Writer, Reviewer, or Repair call', async () => {
    const provider = new FixtureWritingProvider([reviewIssue('hard_blocker')]);
    await runWritingBuild({ rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, fixture: true, syntheticReadyFixture: true, ...pipelineStyle(), provider, writeOutputs: false });
    expect(provider.calls).toBeLessThanOrEqual(3);
  });

  it('62. blocks a Protected Transfer hit', () => {
    const corpus = buildStyleFixtureDocuments({ profileId: 'fixture-reference', profileType: 'reference_technique', rightsStatus: 'public_reference' });
    const phrase = corpus[0]!.text.slice(0, 16);
    const index = buildProtectedTransferIndex(corpus, [{ kind: 'signature_phrase', text: phrase, source_document_ids: [corpus[0]!.document_id], extraction_reason: 'test' }]);
    const result = guardAgainstPlagiarism({ draft: `这里复制了${phrase}`, corpus, protectedIndexes: resolveFixtureProtectedTransferIndexes([index]) });
    expect(result).toMatchObject({ status: 'blocked' });
  });

  it('63. blocks long or dense public Reference overlap', () => {
    const corpus = buildStyleFixtureDocuments({ profileId: 'fixture-reference', profileType: 'reference_technique', rightsStatus: 'public_reference' });
    const result = guardAgainstPlagiarism({ draft: corpus[0]!.text, corpus, protectedIndexes: resolveFixtureProtectedTransferIndexes() });
    expect(result.issues.map(({ issue_code }) => issue_code)).toContain('public_reference_text_overlap');
  });

  it('64. exempts only visibly quoted, exact authorized Research quotes', () => {
    const claim = context.research.verified_claims[0]!;
    const authorized = resolveAuthorizedResearchQuotes(context.research);
    const corpus = [{ ...buildStyleFixtureDocuments({ profileId: 'fixture-reference', profileType: 'reference_technique', rightsStatus: 'public_reference', count: 1 })[0]!, text: claim.quote }];
    expect(guardAgainstPlagiarism({ draft: `资料写道：“${claim.quote}”`, corpus, protectedIndexes: resolveFixtureProtectedTransferIndexes(), authorizedResearchQuotes: authorized }).status).toBe('pass');
    expect(guardAgainstPlagiarism({ draft: `资料写道${claim.quote}`, corpus, protectedIndexes: resolveFixtureProtectedTransferIndexes(), authorizedResearchQuotes: authorized }).status).toBe('blocked');
  });

  it('65. does not store raw model responses or event streams in the Writing Pack', async () => {
    const result = await runWritingBuild({ rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, fixture: true, syntheticReadyFixture: true, ...pipelineStyle(), writeOutputs: false });
    expect(JSON.stringify(result.pack)).not.toMatch(/raw_model|event_stream|stdout|stderr/u);
  });

  it('66. does not store chain-of-thought fields', () => {
    expect(JSON.stringify(context.output)).not.toMatch(/chain.of.thought|reasoning_trace|思维链/iu);
  });

  it('67. writes Provisional dry-runs only to a private temporary directory', async () => {
    const result = await runWritingBuild({ rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, fixture: true, syntheticReadyFixture: true, ...pipelineStyle() });
    expect(result.files_written).toBe(false); expect(result.temporary_output_directory).toMatch(/^\/var\/folders\/|^\/tmp\//u);
    await expect(access(path.join(process.cwd(), 'data/writing-packs/2026-08-14/writing-pack.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('68. contains no platform-access or Browser Bridge call in the Writing pipeline', async () => {
    const source = await readFile(path.join(process.cwd(), 'src/writing/pipeline.ts'), 'utf8');
    expect(source).not.toMatch(/opencli|Browser Bridge|twitter-collector|weixin-collector/iu);
  });

  it('69. creates only not_started Visual Slots and no image prompts', () => {
    expect(context.output.visual_slots.every(({ generation_status }) => generation_status === 'not_started')).toBe(true);
    expect(JSON.stringify(context.output.visual_slots)).not.toMatch(/prompt|image_url|generated_image/iu);
  });

  it('70. keeps the Human Send Gate required and automated publishing disabled', async () => {
    const result = await runWritingBuild({ rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, fixture: true, syntheticReadyFixture: true, ...pipelineStyle(), writeOutputs: false });
    expect(result.pack.human_gate).toEqual({ required: true, status: 'unreviewed', automated_publish_allowed: false });
  });

  it('71. does not restore Xiaohongshu as an output', async () => {
    const source = await readFile(path.join(process.cwd(), 'src/writing/schemas.ts'), 'utf8');
    expect(source).not.toMatch(/xiaohongshu|小红书/iu);
  });

  it('72. blocks an unsupported Claim attached to a factual Block', () => {
    const research = structuredClone(context.research); research.verified_claims[0] = { ...research.verified_claims[0]!, support_status: 'unsupported', source_id: null, segment_id: null, quote: '', scope_limit: '' };
    const audits = runDeterministicWritingAudits({ output: context.output, ...context.rendered, research, product: context.product, recipes: context.recipes, style: context.snapshot });
    expect(blockingAuditIssues(audits).map(({ issue_code }) => issue_code)).toContain('unsupported_claim_used');
  });

  it('73. blocks an unbounded partial Claim', () => {
    const research = structuredClone(context.research); research.verified_claims[0] = { ...research.verified_claims[0]!, support_status: 'partial', scope_limit: '只限当前样例。' };
    const audits = runDeterministicWritingAudits({ output: context.output, ...context.rendered, research, product: context.product, recipes: context.recipes, style: context.snapshot });
    expect(blockingAuditIssues(audits).map(({ issue_code }) => issue_code)).toContain('partial_claim_overstated');
  });

  it('74. blocks an unconfirmed public price or Product claim', () => {
    const output = writerOutputSchema.parse({ ...context.output, blocks: context.output.blocks.map((block, index) => index === 0 ? { ...block, text: `${block.text} 价格 365 元。` } : block) });
    const rendered = renderWriterOutput(output, context.research);
    const audits = runDeterministicWritingAudits({ output, ...rendered, research: context.research, product: context.product, recipes: context.recipes, style: context.snapshot });
    expect(blockingAuditIssues(audits).map(({ issue_code }) => issue_code)).toContain('forbidden_product_claim');
  });

  it('75. blocks an unevidenced factual first-person sentence', () => {
    const output = writerOutputSchema.parse({ ...context.output, blocks: context.output.blocks.map((block, index) => index === 0 ? { ...block, text: `${block.text} 我最近用了这个方法。`, is_opinion: false, persona_fact_ids: [] } : block) });
    const rendered = renderWriterOutput(output, context.research);
    const audits = runDeterministicWritingAudits({ output, ...rendered, research: context.research, product: context.product, recipes: context.recipes, style: context.snapshot });
    expect(blockingAuditIssues(audits).map(({ issue_code }) => issue_code)).toContain('unsupported_first_person_fact');
  });

  it('76. never supplies closed, deleted, or raw approval material to Writer', async () => {
    class CapturingProvider extends FixtureWritingProvider {
      writerInput: unknown = null;
      override async write(input: unknown) { this.writerInput = input; return super.write(input); }
    }
    const provider = new CapturingProvider();
    await runWritingBuild({ rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, fixture: true, syntheticReadyFixture: true, ...pipelineStyle(), provider, writeOutputs: false });
    const serialized = JSON.stringify(provider.writerInput);
    expect(serialized).not.toMatch(/OCV-09|CON-05|OCV-10|approval-receipt|binding-attestation|blind-map|protected_text/iu);
  });

  it('77. emits a Structured Outputs-compatible Writer JSON Schema without tuple items arrays', () => {
    const schema = toJSONSchema(writerOutputSchema, { target: 'draft-7' });
    const visit = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(visit);
      if (value === null || typeof value !== 'object') return false;
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.items)) return true;
      return Object.values(record).some(visit);
    };
    expect(visit(schema)).toBe(false);
    expect(JSON.stringify(schema)).not.toContain('"format":"uri"');
  });
});
