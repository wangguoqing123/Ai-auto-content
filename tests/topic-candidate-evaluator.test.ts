import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { evaluateCandidate, evidenceReferenceExists } from '../src/topic-intelligence/candidate-evaluator.js';
import { loadTopicProductTruth, type LoadedProductTruth } from '../src/topic-intelligence/product-context.js';
import { buildFixtureMaterialInput } from '../src/topic-intelligence/providers/fixture-topic-judge-provider.js';
import { topicMaterialCardSchema } from '../src/topic-intelligence/schemas.js';
import type { ProductProfile } from '../src/product/product-profile.js';
import { makeTopicCandidate, topicConfig } from './topic-test-helpers.js';

let truth: LoadedProductTruth;
const roots: string[] = [];
beforeAll(async () => { truth = await loadTopicProductTruth(process.cwd()); });
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function evaluate(
  overrides: Parameters<typeof makeTopicCandidate>[0] = {},
  product: ProductProfile = truth.product,
  materials = buildFixtureMaterialInput().materialById,
  rootDir = process.cwd(),
) {
  return evaluateCandidate(makeTopicCandidate(overrides), {
    rootDir,
    config: await topicConfig(),
    product,
    contentFit: truth.contentFit,
    materials,
    history: [],
    contentMix: truth.context.contentMix,
  });
}

describe('topic candidate scoring and product truth enforcement', () => {
  it('approves the valid offline fixture above 80', async () => {
    const result = await evaluate();
    expect(result.evaluation_status).toBe('approved');
    expect(result.scores.total_score).toBe(92);
  });

  it.each([
    ['ai_video_production', 'ai_video_production', 'tool_selection', 3],
    ['ai_content_automation', 'content_automation', 'workflow_building', 10],
    ['complete_projects', 'projects_cases_and_templates', 'project_delivery', 5],
    ['real_case_library', 'projects_cases_and_templates', 'project_delivery', 7],
  ] as const)('caps module %s at %i', async (moduleId, pillar, stage, cap) => {
    const result = await evaluate({
      primary_product_module_id: moduleId,
      content_pillar: pillar,
      learner_stage: stage,
      scores: { ...makeTopicCandidate().scores, product_fit_score: 10 },
      cta_mode: 'none',
    });
    expect(result.effective_product_fit_cap).toBe(cap);
    expect(result.scores.product_fit_score).toBe(cap);
  });

  it('uses the lower pillar cap even when the module cap is higher', async () => {
    const result = await evaluate({
      primary_product_module_id: 'membership_home',
      content_pillar: 'curation_and_community',
      learner_stage: 'tool_selection',
      scores: { ...makeTopicCandidate().scores, product_fit_score: 10 },
      cta_mode: 'none',
    });
    expect(result.effective_product_fit_cap).toBe(5);
  });

  it('uses the minimum cap across primary and supporting modules', async () => {
    const result = await evaluate({
      primary_product_module_id: 'real_case_library',
      supporting_product_module_ids: ['complete_projects'],
      content_pillar: 'projects_cases_and_templates',
      learner_stage: 'project_delivery',
      scores: { ...makeTopicCandidate().scores, product_fit_score: 10 },
      cta_mode: 'none',
    });
    expect(result.effective_product_fit_cap).toBe(5);
  });

  it('does not let a supporting module raise the primary cap', async () => {
    const result = await evaluate({
      primary_product_module_id: 'complete_projects',
      supporting_product_module_ids: ['real_case_library'],
      content_pillar: 'projects_cases_and_templates',
      learner_stage: 'project_delivery',
      scores: { ...makeTopicCandidate().scores, product_fit_score: 10 },
      cta_mode: 'none',
    });
    expect(result.effective_product_fit_cap).toBe(5);
  });

  it.each([
    ['missing_module', 'invalid_product_module_mapping'],
    ['ai_video_production', 'invalid_product_module_mapping'],
  ])('rejects illegal pillar mapping for %s', async (moduleId, reason) => {
    const result = await evaluate({ primary_product_module_id: moduleId, supporting_product_module_ids: [], content_pillar: 'content_automation' });
    expect(result.hard_reject_reasons).toContain(reason);
    expect(result.scores.product_fit_score).toBe(0);
  });

  it('downgrades direction-only club CTA to light and records it', async () => {
    const result = await evaluate({
      primary_product_module_id: 'ai_video_production', content_pillar: 'ai_video_production', learner_stage: 'tool_selection', cta_mode: 'club',
    });
    expect(result.cta_mode).toBe('light');
    expect(result.cta_adjusted_from).toBe('club');
  });

  it.each([
    ['ai_content_automation', 'content_automation', 'workflow_building'],
    ['real_case_library', 'projects_cases_and_templates', 'project_delivery'],
  ] as const)('allows club for %s when directly mapped', async (moduleId, pillar, stage) => {
    const result = await evaluate({ primary_product_module_id: moduleId, content_pillar: pillar, learner_stage: stage, cta_mode: 'club' });
    expect(result.cta_mode).toBe('club');
    expect(result.price_refresh_required).toBe(true);
  });

  it('allows only none for an unknown delivery module', async () => {
    const product = structuredClone(truth.product);
    const module = product.delivery_catalog.find(({ id }) => id === 'ai_content_automation');
    if (module === undefined) throw new Error('fixture module missing');
    module.delivery_status = 'unknown';
    const result = await evaluate({ cta_mode: 'club' }, product);
    expect(result.cta_mode).toBe('none');
  });

  it('prevents lead generation club CTA below product fit 7', async () => {
    const result = await evaluate({
      primary_product_module_id: 'complete_projects', content_pillar: 'projects_cases_and_templates', learner_stage: 'project_delivery',
      funnel_role: 'lead_generation', cta_mode: 'club', scores: { ...makeTopicCandidate().scores, product_fit_score: 5 },
    });
    expect(result.cta_mode).toBe('light');
  });

  it('allows a confirmed product claim', async () => {
    expect((await evaluate({ product_claim_ids: ['product.learning.content_automation'] })).hard_reject_reasons).toEqual([]);
  });

  it.each([
    'product.remaining_slots',
    'product.price_increase_deadline',
    'product.fixed_update_frequency',
    'product.guaranteed_income',
  ])('rejects forbidden product claim %s', async (claimId) => {
    expect((await evaluate({ product_claim_ids: [claimId] })).hard_reject_reasons).toContain(`forbidden_product_claim:${claimId}`);
  });

  it('rejects an unknown product claim', async () => {
    expect((await evaluate({ product_claim_ids: ['product.invented.benefit'] })).hard_reject_reasons).toContain('unknown_product_claim:product.invented.benefit');
  });

  it('rejects evidence-required claims without a reference', async () => {
    expect((await evaluate({ product_claim_ids: ['product.practice.measured_result'] })).hard_reject_reasons)
      .toContain('missing_product_claim_evidence:product.practice.measured_result');
  });

  it('accepts a real material evidence reference', async () => {
    const result = await evaluate({
      product_claim_ids: ['product.practice.measured_result'],
      product_claim_evidence: [{ claim_id: 'product.practice.measured_result', evidence_refs: ['material:mat_111111111111'] }],
    });
    expect(result.hard_reject_reasons).not.toContain('invalid_product_claim_evidence:product.practice.measured_result');
  });

  it.each(['experiment', 'project', 'case'] as const)('validates real %s evidence files', async (kind) => {
    const root = await mkdtemp(path.join(tmpdir(), 'topic-evidence-'));
    roots.push(root);
    const directory = `${kind}s`;
    await mkdir(path.join(root, 'data', 'evidence', directory), { recursive: true });
    await writeFile(path.join(root, 'data', 'evidence', directory, 'real-id.json'), JSON.stringify({ [`${kind}_id`]: 'real-id' }), 'utf8');
    await expect(evidenceReferenceExists(`${kind}:real-id`, root, buildFixtureMaterialInput().materialById)).resolves.toBe(true);
  });

  it('does not accept an arbitrary non-empty evidence reference', async () => {
    await expect(evidenceReferenceExists('experiment:not-real', process.cwd(), buildFixtureMaterialInput().materialById)).resolves.toBe(false);
  });

  it('recalculates total score instead of trusting a model total', async () => {
    const result = await evaluate({ scores: { pain_score: 1, actionability_score: 2, demonstrability_score: 3, evidence_score: 4, engagement_potential_score: 5, product_fit_score: 6 } });
    expect(result.scores.total_score).toBe(21);
  });

  it('records product cap adjustment without a model repair call', async () => {
    const result = await evaluate({ primary_product_module_id: 'ai_video_production', content_pillar: 'ai_video_production', learner_stage: 'tool_selection' });
    expect(result.product_fit_cap_applied).toBe(true);
  });

  it('caps evidence at 10 with no fact source but a concrete experiment', async () => {
    const result = await evaluate({ fact_source_ids: [], supported_claims: [], scores: { ...makeTopicCandidate().scores, evidence_score: 15 } });
    expect(result.scores.evidence_score).toBe(10);
  });

  it('caps evidence at 5 with neither fact source nor experiment', async () => {
    const result = await evaluate({ fact_source_ids: [], supported_claims: [], requires_experiment: false, experiment_plan: [], proof_format: '步骤清单', scores: { ...makeTopicCandidate().scores, evidence_score: 15 } });
    expect(result.scores.evidence_score).toBe(5);
  });

  it('hard-rejects time-sensitive facts without a fact source', async () => {
    expect((await evaluate({ time_sensitive: true, fact_source_ids: [], supported_claims: [] })).hard_reject_reasons)
      .toContain('time_sensitive_topic_without_fact_source');
  });

  it('rejects supported claims that cite X trend signals', async () => {
    const result = await evaluate({
      supported_claims: [{ claim: 'UGC is not factual proof', fact_source_ids: ['mat_222222222222'] }],
    });
    expect(result.hard_reject_reasons).toContain('supported_claim_without_fact_source');
  });

  it('rejects restricted material in fact_source_ids', async () => {
    expect((await evaluate({ fact_source_ids: ['mat_333333333333'] })).hard_reject_reasons).toContain('invalid_fact_source_reference');
  });

  it('requires an experiment plan for comparison language', async () => {
    const result = await evaluate({ working_title: '两个工作流实测对比', requires_experiment: false, experiment_plan: [] });
    expect(result.requires_experiment).toBe(true);
    expect(result.hard_reject_reasons).toContain('experiment_plan_required');
  });

  it('rejects fabricated first-person testing experience', async () => {
    expect((await evaluate({ one_sentence_promise: '七天假亲测有效，保证你能更快完成任务。' })).hard_reject_reasons)
      .toContain('unconfirmed_first_person_experience');
  });

  it.each([
    ['user_problem', '短', 'missing_clear_user_problem'],
    ['real_task', '短', 'missing_real_task'],
    ['minimum_result', '短', 'missing_minimum_result'],
  ] as const)('hard-rejects weak %s', async (field, value, reason) => {
    expect((await evaluate({ [field]: value })).hard_reject_reasons).toContain(reason);
  });

  it.each(['震惊', '颠覆', '封神', '必看'])('rejects exaggerated title token %s', async (token) => {
    expect((await evaluate({ working_title: `${token}：AI 工作流` })).hard_reject_reasons).toContain('requires_exaggerated_title');
  });

  it('keeps a high-scoring candidate rejected when a hard reason exists', async () => {
    expect((await evaluate({ hard_reject_reasons: ['only_restates_news'] })).evaluation_status).toBe('rejected');
  });

  it('keeps a candidate below 80 from selection', async () => {
    const result = await evaluate({ scores: { pain_score: 10, actionability_score: 10, demonstrability_score: 10, evidence_score: 10, engagement_potential_score: 10, product_fit_score: 10 } });
    expect(result.scores.total_score).toBe(60);
    expect(result.evaluation_status).toBe('rejected');
  });

  it('refuses xiaohongshu as active fact evidence', async () => {
    const input = buildFixtureMaterialInput();
    input.materialById.set('mat_444444444444', topicMaterialCardSchema.parse({
      ...input.cards[0], material_id: 'mat_444444444444', source_platform: 'xiaohongshu', canonical_url: 'https://example.com/legacy', role: 'fact_source',
    }));
    expect((await evaluate({ fact_source_ids: ['mat_444444444444'] }, truth.product, input.materialById)).hard_reject_reasons)
      .toContain('xiaohongshu_evidence_forbidden');
  });
});
