import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkRecentDuplicate,
  computeTopicSignature,
  loadTopicHistory,
  normalizeTopicText,
  tokenJaccard,
  type TopicHistoryEntry,
} from '../src/topic-intelligence/history.js';
import { evaluateCandidate } from '../src/topic-intelligence/candidate-evaluator.js';
import { loadTopicProductTruth } from '../src/topic-intelligence/product-context.js';
import { buildFixtureMaterialInput } from '../src/topic-intelligence/providers/fixture-topic-judge-provider.js';
import { makeTopicCandidate, topicConfig } from './topic-test-helpers.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function historyEntry(overrides: Partial<TopicHistoryEntry> = {}): TopicHistoryEntry {
  const candidate = makeTopicCandidate();
  return {
    decisionDate: '2026-08-10',
    topicSignature: computeTopicSignature(candidate),
    workingTitle: candidate.working_title,
    userProblem: candidate.user_problem,
    minimumResult: candidate.minimum_result,
    coreAngle: candidate.core_angle,
    contentPillar: candidate.content_pillar,
    evidenceRefs: candidate.fact_source_ids.map((id) => `material:${id}`),
    ...overrides,
  };
}

describe('topic history and deterministic duplicate checks', () => {
  it('normalizes punctuation, case, and whitespace', () => {
    expect(normalizeTopicText('  AI，Workflow!  ')).toBe('ai workflow');
  });

  it('creates a stable 64-character signature in code', () => {
    expect(computeTopicSignature(makeTopicCandidate())).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns the same signature for punctuation-only changes', () => {
    const candidate = makeTopicCandidate();
    expect(computeTopicSignature({ ...candidate, user_problem: `${candidate.user_problem}！` })).toBe(computeTopicSignature(candidate));
  });

  it.each(['learner_stage', 'user_problem', 'real_task', 'minimum_result', 'core_angle'] as const)(
    'changes the signature when %s changes',
    (field) => {
      const candidate = makeTopicCandidate();
      const changed = { ...candidate, [field]: field === 'learner_stage' ? 'task_breakdown' : `${candidate[field]} 完全新场景` };
      expect(computeTopicSignature(changed)).not.toBe(computeTopicSignature(candidate));
    },
  );

  it('calculates Chinese token similarity', () => {
    expect(tokenJaccard('把 AI 任务变成可复用工作流', '把 AI 任务整理为可复用的工作流')).toBeGreaterThanOrEqual(0.5);
  });

  it('detects exact signature duplicates', () => {
    const candidate = makeTopicCandidate();
    expect(checkRecentDuplicate(candidate, computeTopicSignature(candidate), [historyEntry()], [historyEntry()], 0.72)).toMatchObject({ duplicate: true, reason: 'duplicate_exact_signature' });
  });

  it('detects normalized working-title duplicates', () => {
    const candidate = makeTopicCandidate({ core_angle: '全新核心角度' });
    const history = [historyEntry({ topicSignature: 'x', userProblem: '不同问题', minimumResult: '不同结果', coreAngle: '不同角度' })];
    expect(checkRecentDuplicate(candidate, computeTopicSignature(candidate), [], history, 0.72).duplicate).toBe(true);
  });

  it('detects different titles with the same problem and result', () => {
    const candidate = makeTopicCandidate({ working_title: '完全不同的工作标题' });
    const history = [historyEntry({ topicSignature: 'x', workingTitle: '另一个标题' })];
    expect(checkRecentDuplicate(candidate, computeTopicSignature(candidate), [], history, 0.72).duplicate).toBe(true);
  });

  it('allows meaningful novelty backed by a new fact source', () => {
    const candidate = makeTopicCandidate({ novelty_delta: '新增官方工作流规范，并把最小结果改为可验证模板。', new_evidence_refs: ['material:mat_999999999999'] });
    expect(checkRecentDuplicate(candidate, computeTopicSignature(candidate), [historyEntry()], [historyEntry()], 0.72, ['material:mat_999999999999']).duplicate).toBe(false);
  });

  it('allows meaningful novelty backed by a new experiment result', () => {
    const candidate = makeTopicCandidate({ novelty_delta: '新增相同任务的重跑实验结果与失败判断标准。', new_evidence_refs: ['experiment:new-run'] });
    expect(checkRecentDuplicate(candidate, computeTopicSignature(candidate), [historyEntry()], [historyEntry()], 0.72, ['experiment:new-run']).duplicate).toBe(false);
  });

  it('does not accept angle-different as a novelty explanation', () => {
    const candidate = makeTopicCandidate({ novelty_delta: '角度不同', new_evidence_refs: ['material:mat_999999999999'] });
    expect(checkRecentDuplicate(candidate, computeTopicSignature(candidate), [historyEntry()], [historyEntry()], 0.72, ['material:mat_999999999999']).duplicate).toBe(true);
  });

  it.each(['内容更新', '有新证据'])('does not accept vague novelty explanation %s', (noveltyDelta) => {
    const candidate = makeTopicCandidate({ novelty_delta: noveltyDelta, new_evidence_refs: ['experiment:new-run'] });
    expect(checkRecentDuplicate(candidate, computeTopicSignature(candidate), [historyEntry()], [historyEntry()], 0.72, ['experiment:new-run']).duplicate).toBe(true);
  });

  it('does not accept novelty without new evidence', () => {
    const candidate = makeTopicCandidate({ novelty_delta: '新增一个更清楚的用户场景和最小结果。', new_evidence_refs: [] });
    expect(checkRecentDuplicate(candidate, computeTopicSignature(candidate), [historyEntry()], [historyEntry()], 0.72).duplicate).toBe(true);
  });

  it('loads only decisions inside the 30-day window', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'topic-history-'));
    roots.push(root);
    const truth = await loadTopicProductTruth(process.cwd());
    const candidate = await evaluateCandidate(makeTopicCandidate(), {
      rootDir: process.cwd(), config: await topicConfig(), product: truth.product, contentFit: truth.contentFit,
      materials: buildFixtureMaterialInput().materialById, history: [], contentMix: truth.context.contentMix,
    });
    const directory = path.join(root, 'data', 'topic-decisions');
    await mkdir(directory, { recursive: true });
    const base = {
      version: 1, run_id: 'topic_2026-08-01T00-00-00-000Z', status: 'success', decision: 'SELECT_TOPIC',
      prompt_version: 'topic-intelligence-v1', input_hash: '0'.repeat(64), input_summary: {
        total_before_filter: 1, eligible_total: 1, total_after_filter: 1, cloud_count: 1, twitter_count: 0,
        weixin_resolved_count: 0, restricted_count: 0, fact_source_count: 1, trend_signal_count: 0,
        structure_inspiration_count: 0,
        eligible_by_bucket: { cloud: 1, twitter: 0, weixin_resolved: 0, weixin_restricted: 0 },
        selected_by_bucket: { cloud: 1, twitter: 0, weixin_resolved: 0, weixin_restricted: 0 },
        dropped_by_reason: {
          duplicate: 0, outside_window: 0, invalid_status: 0, invalid_url: 0, invalid_material: 0,
          sensitive_content: 0, author_limit: 0, query_limit: 0, cluster_limit: 0, bucket_limit: 0, character_limit: 0,
        }, source_gaps: ['browser_missing'],
      },
      selected_topic: candidate, evaluated_candidates: [candidate], no_publish_reason_code: null, no_publish_reason: null,
      model: { provider: 'fixture', model: 'offline', calls: 1, duration_ms: 1, usage: null }, error_code: null, error_message_safe: null,
      created_at: '2026-08-01T00:00:00.000Z',
    };
    await writeFile(path.join(directory, 'recent.json'), JSON.stringify({ ...base, decision_date: '2026-08-01' }), 'utf8');
    await writeFile(path.join(directory, 'old.json'), JSON.stringify({ ...base, decision_date: '2026-06-01' }), 'utf8');
    expect((await loadTopicHistory(root, '2026-08-14', 30)).map(({ decisionDate }) => decisionDate)).toEqual(['2026-08-01']);
    expect(await loadTopicHistory(root, '2026-08-14', 5)).toEqual([]);
  });

  it('does not force duplicates outside the loaded window', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'topic-history-empty-'));
    roots.push(root);
    expect(await loadTopicHistory(root, '2026-08-14', 30)).toEqual([]);
  });
});
