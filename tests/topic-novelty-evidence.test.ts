import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { evaluateCandidate } from '../src/topic-intelligence/candidate-evaluator.js';
import { computeTopicSignature, type TopicHistoryEntry } from '../src/topic-intelligence/history.js';
import { loadTopicProductTruth, type LoadedProductTruth } from '../src/topic-intelligence/product-context.js';
import { buildFixtureMaterialInput } from '../src/topic-intelligence/providers/fixture-topic-judge-provider.js';
import { topicMaterialCardSchema } from '../src/topic-intelligence/schemas.js';
import { makeTopicCandidate, topicConfig } from './topic-test-helpers.js';

let truth: LoadedProductTruth;
const roots: string[] = [];
beforeAll(async () => { truth = await loadTopicProductTruth(process.cwd()); });
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function duplicateHistory(): TopicHistoryEntry {
  const candidate = makeTopicCandidate();
  return {
    decisionDate: '2026-08-10', topicSignature: computeTopicSignature(candidate), workingTitle: candidate.working_title,
    userProblem: candidate.user_problem, minimumResult: candidate.minimum_result, coreAngle: candidate.core_angle,
    contentPillar: candidate.content_pillar, evidenceRefs: candidate.fact_source_ids.map((id) => `material:${id}`),
  };
}

async function evaluateNovelty(rootDir: string, reference: `experiment:${string}`) {
  const history = [duplicateHistory()];
  return evaluateCandidate(makeTopicCandidate({
    novelty_delta: '新增重跑实验结果、验收数据与明确的失败判断标准。',
    new_evidence_refs: [reference],
  }), {
    rootDir, config: await topicConfig(), product: truth.product, contentFit: truth.contentFit,
    materials: buildFixtureMaterialInput().materialById, history, exactHistory: history, similarityHistory: history,
    contentMix: truth.context.contentMix,
  });
}

describe('validated novelty evidence', () => {
  it('hard-rejects a fabricated evidence reference and does not bypass a duplicate', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'topic-novelty-fake-'));
    roots.push(root);
    const result = await evaluateNovelty(root, 'experiment:invented');
    expect(result.hard_reject_reasons).toContain('invalid_novelty_evidence');
    expect(result.hard_reject_reasons).toContain('duplicate_exact_signature');
  });

  it('hard-rejects a nonexistent material reference', async () => {
    const history = [duplicateHistory()];
    const result = await evaluateCandidate(makeTopicCandidate({
      novelty_delta: '新增可验证的官方事实和一个不同的最小交付结果。',
      new_evidence_refs: ['material:mat_999999999999'],
    }), {
      rootDir: process.cwd(), config: await topicConfig(), product: truth.product, contentFit: truth.contentFit,
      materials: buildFixtureMaterialInput().materialById, history, exactHistory: history, similarityHistory: history,
      contentMix: truth.context.contentMix,
    });
    expect(result.hard_reject_reasons).toContain('invalid_novelty_evidence');
    expect(result.hard_reject_reasons).toContain('duplicate_exact_signature');
  });

  it('allows a duplicate bypass only with a valid new experiment JSON record', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'topic-novelty-valid-'));
    roots.push(root);
    const directory = path.join(root, 'data', 'evidence', 'experiments');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'run.json'), JSON.stringify({ experiment_id: 'new-run' }), 'utf8');
    const result = await evaluateNovelty(root, 'experiment:new-run');
    expect(result.hard_reject_reasons).not.toContain('invalid_novelty_evidence');
    expect(result.hard_reject_reasons).not.toContain('duplicate_exact_signature');
  });

  it('allows a duplicate bypass with a real new fact_source from current input', async () => {
    const input = buildFixtureMaterialInput();
    input.materialById.set('mat_555555555555', topicMaterialCardSchema.parse({
      ...input.cards[0], material_id: 'mat_555555555555', canonical_url: 'https://example.com/new-official-fact',
    }));
    const history = [duplicateHistory()];
    const result = await evaluateCandidate(makeTopicCandidate({
      novelty_delta: '新增官方事实，并把最小结果改为可现场验收的新模板。',
      new_evidence_refs: ['material:mat_555555555555'],
    }), {
      rootDir: process.cwd(), config: await topicConfig(), product: truth.product, contentFit: truth.contentFit,
      materials: input.materialById, history, exactHistory: history, similarityHistory: history,
      contentMix: truth.context.contentMix,
    });
    expect(result.hard_reject_reasons).not.toContain('invalid_novelty_evidence');
    expect(result.hard_reject_reasons).not.toContain('duplicate_exact_signature');
  });

  it.each(['mat_222222222222', 'mat_333333333333'])('does not allow %s as novelty fact evidence', async (materialId) => {
    const history = [duplicateHistory()];
    const result = await evaluateCandidate(makeTopicCandidate({
      novelty_delta: '新增用户场景、明确的结果验收方式和新的证据。',
      new_evidence_refs: [`material:${materialId}`],
    }), {
      rootDir: process.cwd(), config: await topicConfig(), product: truth.product, contentFit: truth.contentFit,
      materials: buildFixtureMaterialInput().materialById, history, exactHistory: history, similarityHistory: history,
      contentMix: truth.context.contentMix,
    });
    expect(result.hard_reject_reasons).toContain('invalid_novelty_evidence');
  });
});
