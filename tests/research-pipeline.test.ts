import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeResearchInputHash } from '../src/research/input-hash.js';
import { buildFixtureResearchSources } from '../src/research/fixture.js';
import { runResearchBuild } from '../src/research/pipeline.js';
import { FixtureResearchProvider } from '../src/research/providers/fixture-research-provider.js';
import { ResearchProviderTimeoutError, ResearchProviderUnavailableError, type ResearchProviderInput } from '../src/research/providers/research-provider.js';
import { acquiredSnapshot, acquireResearchSources } from '../src/research/source-acquisition.js';
import { loadFactSourceMaterials } from '../src/research/source-materials.js';
import { researchPackSchema } from '../src/research/schemas.js';
import { topicDecisionSchema } from '../src/topic-intelligence/schemas.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function root(options: { topic?: 'valid' | 'missing' | 'corrupt' | 'mismatch' | 'failed' | 'no-publish' } = {}) {
  const target = await mkdtemp(path.join(os.tmpdir(), 'research-pipeline-'));
  roots.push(target);
  await cp(path.join(process.cwd(), 'config'), path.join(target, 'config'), { recursive: true });
  await mkdir(path.join(target, 'data', 'materials'), { recursive: true });
  for (const name of await readdir(path.join(process.cwd(), 'data', 'materials'))) {
    if (name.endsWith('.jsonl')) await cp(path.join(process.cwd(), 'data', 'materials', name), path.join(target, 'data', 'materials', name));
  }
  const mode = options.topic ?? 'valid';
  if (mode === 'missing') return target;
  await mkdir(path.join(target, 'data', 'topic-decisions'), { recursive: true });
  const source = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'topic-decisions', '2026-08-14.json'), 'utf8')) as Record<string, unknown>;
  if (mode === 'corrupt') {
    await writeFile(path.join(target, 'data', 'topic-decisions', '2026-08-14.json'), '{not-json');
    return target;
  }
  if (mode === 'mismatch') source.decision_date = '2026-08-13';
  if (mode === 'failed') {
    source.status = 'failed'; source.decision = null; source.selected_topic = null;
    source.error_code = 'model_unavailable'; source.error_message_safe = 'fixture failure';
  }
  if (mode === 'no-publish') {
    source.decision = 'NO_PUBLISH'; source.selected_topic = null;
    source.no_publish_reason_code = 'weak_user_value'; source.no_publish_reason = 'No topic today.';
  }
  await writeFile(path.join(target, 'data', 'topic-decisions', '2026-08-14.json'), `${JSON.stringify(source, null, 2)}\n`);
  return target;
}

class CountingFixtureProvider extends FixtureResearchProvider {
  analyzeCalls = 0;
  repairCalls = 0;
  override async analyze(input: ResearchProviderInput) {
    this.analyzeCalls += 1;
    return super.analyze(input);
  }
  override async repair(input: ResearchProviderInput, errors: string[]) {
    this.repairCalls += 1;
    return super.repair(input, errors);
  }
}

describe('Research Pack pipeline', () => {
  it('keeps excerpt-only fixture research incomplete while still running the experiment', async () => {
    const repository = await root();
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true });
    expect(result.pack).toMatchObject({ status: 'success', decision: 'RESEARCH_INCOMPLETE' });
    expect(result.pack.topic?.working_title).toBe('别再只让 AI 给建议：把一个日常任务改造成可验收的执行流程');
  });

  it('does not replace the selected mother topic', async () => {
    const repository = await root();
    const decision = topicDecisionSchema.parse(JSON.parse(await readFile(path.join(repository, 'data/topic-decisions/2026-08-14.json'), 'utf8')));
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true });
    expect(result.pack.topic?.topic_signature).toBe(decision.selected_topic?.topic_signature);
    expect(result.pack.topic?.primary_product_module_id).toBe(decision.selected_topic?.primary_product_module_id);
    expect(result.pack.topic?.cta_mode).toBe(decision.selected_topic?.cta_mode);
  });

  it('maps NO_PUBLISH to NO_TOPIC without source fetch or provider calls', async () => {
    const repository = await root({ topic: 'no-publish' });
    const provider = new CountingFixtureProvider();
    const fetchSource = vi.fn();
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', provider, fetchSource, dryRun: true });
    expect(result.pack).toMatchObject({ status: 'success', decision: 'NO_TOPIC', model: { calls: 0 } });
    expect(fetchSource).not.toHaveBeenCalled();
    expect(provider.analyzeCalls).toBe(0);
    expect(provider.experimentCalls).toEqual([]);
  });

  it.each([
    ['missing', 'topic_input_missing'],
    ['corrupt', 'topic_input_invalid'],
    ['mismatch', 'topic_input_invalid'],
    ['failed', 'topic_input_invalid'],
  ] as const)('fails closed for %s Topic Decision input', async (topicMode, errorCode) => {
    const repository = await root({ topic: topicMode });
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true });
    expect(result.pack).toMatchObject({ status: 'failed', decision: null, error_code: errorCode, model: { calls: 0 } });
  });

  it('fixture mode never calls the network or writes the local cache', async () => {
    const repository = await root();
    const fetchSource = vi.fn();
    const cacheRoot = path.join(repository, 'cache-should-not-exist');
    await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true, fetchSource, cacheRoot });
    expect(fetchSource).not.toHaveBeenCalled();
    await expect(stat(cacheRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('dry-run writes no formal Research Pack files', async () => {
    const repository = await root();
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true });
    expect(result.files_written).toBe(false);
    await expect(stat(path.join(repository, 'data/research-packs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('formal fixture execution writes only the documented research artifacts', async () => {
    const repository = await root();
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true });
    expect(result.files_written).toBe(true);
    const packPath = path.join(repository, 'data/research-packs/2026-08-14/research-pack.json');
    expect(researchPackSchema.parse(JSON.parse(await readFile(packPath, 'utf8'))).decision).toBe('RESEARCH_INCOMPLETE');
    const reportPath = path.join(repository, 'reports/research/2026-08-14.md');
    await expect(stat(reportPath)).resolves.toBeDefined();
    const report = await readFile(reportPath, 'utf8');
    expect(report).toContain('获取方式：persisted_official_rss_excerpt');
    expect(report).toContain('内容范围：feed_excerpt');
    expect(report).toContain('降级原因：canonical_access_blocked');
  });

  it('committed artifacts contain no clean segments, raw HTML, or event stream', async () => {
    const repository = await root();
    await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true });
    const serialized = await readFile(path.join(repository, 'data/research-packs/2026-08-14/research-pack.json'), 'utf8');
    expect(serialized).not.toMatch(/"segments"|<html|turn\.completed|chain.of.thought/i);
  });

  it('same successful input_hash returns ALREADY_RESEARCHED without provider or experiment calls', async () => {
    const repository = await root();
    const firstProvider = new CountingFixtureProvider();
    await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, provider: firstProvider });
    const secondProvider = new CountingFixtureProvider();
    const second = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, provider: secondProvider });
    expect(second.execution_status).toBe('ALREADY_RESEARCHED');
    expect(secondProvider.analyzeCalls).toBe(0);
    expect(secondProvider.repairCalls).toBe(0);
    expect(secondProvider.experimentCalls).toEqual([]);
  });

  it('a changed source content hash changes Research input_hash', async () => {
    const repository = await root();
    const decision = topicDecisionSchema.parse(JSON.parse(await readFile(path.join(repository, 'data/topic-decisions/2026-08-14.json'), 'utf8')));
    const materials = await loadFactSourceMaterials(repository, decision, 5);
    const common = { rootDir: repository, topicDecision: decision, materials, provider: 'fixture', model: 'offline-fixture', runtimeVersion: 'fixture-v1', promptVersion: 'research-pack-v1' };
    const hashSource = (materialId: string, hash: string) => ({
      material_id: materialId, content_sha256: hash, retrieval_method: 'persisted_official_rss_excerpt' as const,
      content_scope: 'feed_excerpt' as const, retrieval_url: 'https://openai.com/news/rss.xml',
      canonical_fetch_status: 'blocked' as const, canonical_http_status: 403, fetch_status: 'success' as const,
    });
    const first = await computeResearchInputHash({ ...common, sources: materials.map(({ material }) => hashSource(material.material_id, 'a'.repeat(64))) });
    const second = await computeResearchInputHash({ ...common, sources: materials.map(({ material }, index) => hashSource(material.material_id, (index === 0 ? 'b' : 'a').repeat(64))) });
    expect(first).not.toBe(second);
  });

  it('classifies source/network infrastructure failure as status=failed, not RESEARCH_INCOMPLETE', async () => {
    const repository = await root();
    const provider = new CountingFixtureProvider();
    const result = await runResearchBuild({
      rootDir: repository, researchDate: '2026-08-14', dryRun: true,
      provider,
      acquireSources: async (materials, config) => acquireResearchSources(materials.map((source) => ({
        ...source, provenance: { ...source.provenance, source_config_url: null },
      })), config, { fetchCanonical: async () => { throw new Error('simulated network failure'); } }),
    });
    expect(result.pack).toMatchObject({
      status: 'failed', decision: null, error_code: 'source_fetch_failed',
      source_summary: { requested: 2, fetched: 0, failed: 2, unsupported_content_type: 0, unavailable: 2 },
    });
    expect(provider.analyzeCalls).toBe(0);
    expect(provider.experimentCalls).toEqual([]);
  });

  it('continues with one acquired and one unavailable source as RESEARCH_INCOMPLETE', async () => {
    const repository = await root();
    const provider = new CountingFixtureProvider();
    const result = await runResearchBuild({
      rootDir: repository, researchDate: '2026-08-14', dryRun: true, provider,
      cacheRoot: path.join(repository, 'research-cache'),
      acquireSources: async (materials, config) => acquireResearchSources([
        materials[0]!,
        { ...materials[1]!, provenance: { ...materials[1]!.provenance, source_config_url: null } },
      ], config, {
        fetchCanonical: async () => { throw new Error('simulated canonical failure'); },
        replayRss: async () => null,
      }),
    });
    expect(result.pack).toMatchObject({
      status: 'success', decision: 'RESEARCH_INCOMPLETE',
      source_summary: { requested: 2, fetched: 1, failed: 1, unavailable: 1 },
      readiness: { fact_claims_verified: false },
    });
    expect(result.pack.verified_claims.find(({ claim_id }) => claim_id === 'claim_supported_2')?.support_status).toBe('unsupported');
    expect(provider.experimentCalls).toEqual(['baseline_chat_request', 'structured_task_card']);
  });

  it('classifies a Codex infrastructure error as status=failed', async () => {
    const repository = await root();
    const provider = new CountingFixtureProvider();
    provider.analyze = async () => { throw new ResearchProviderUnavailableError('codex_not_authenticated'); };
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true, provider });
    expect(result.pack).toMatchObject({ status: 'failed', decision: null, error_code: 'codex_not_authenticated', model: { calls: 1 } });
  });

  it('repairs a quote mismatch once and fails invalid_source_quote when it remains invalid', async () => {
    const repository = await root();
    const provider = new CountingFixtureProvider();
    const breakQuote = async (input: ResearchProviderInput) => {
      const call = await FixtureResearchProvider.prototype.analyze.call(provider, input);
      call.output.verified_claims[0]!.quote = 'fabricated quote';
      return call;
    };
    provider.analyze = breakQuote;
    provider.repair = async (input) => breakQuote(input);
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true, provider });
    expect(result.pack).toMatchObject({ status: 'failed', decision: null, error_code: 'invalid_source_quote', model: { calls: 2 } });
  });

  it('returns RESEARCH_INCOMPLETE when a core question is unanswered but infrastructure succeeds', async () => {
    const repository = await root();
    const provider = new CountingFixtureProvider();
    const original = provider.analyze.bind(provider);
    provider.analyze = async (input) => {
      const call = await original(input);
      call.output.research_answers[0] = {
        question: input.topic.research_questions[0]!, answer_status: 'unanswered', gap_impact: 'blocking', answer: '', supporting_claim_ids: [], remaining_gap: 'Source does not answer this question.',
      };
      return call;
    };
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true, provider });
    expect(result.pack).toMatchObject({ status: 'success', decision: 'RESEARCH_INCOMPLETE', readiness: { research_questions_sufficient: false } });
  });

  it('allows partial non-blocking answers through the research-question sufficiency gate', async () => {
    const repository = await root();
    const provider = new CountingFixtureProvider();
    const original = provider.analyze.bind(provider);
    provider.analyze = async (input) => {
      const call = await original(input);
      call.output.research_answers = input.topic.research_questions.map((question, index) => ({
        question,
        answer_status: 'partial' as const,
        gap_impact: 'non_blocking' as const,
        answer: 'The available official excerpt provides bounded context.',
        supporting_claim_ids: [`claim_supported_${Math.min(index + 1, 2)}`],
        remaining_gap: 'More detail would be useful but is not required for the bounded conclusion.',
      }));
      return call;
    };
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true, provider });
    expect(result.pack.readiness.research_questions_sufficient).toBe(true);
    expect(result.pack.decision).toBe('RESEARCH_INCOMPLETE');
  });

  it('runs both variants when the experiment task-selection question is answered from the project catalog', async () => {
    const repository = await root();
    const provider = new CountingFixtureProvider();
    const original = provider.analyze.bind(provider);
    provider.analyze = async (input) => {
      const call = await original(input);
      call.output.research_answers[2] = {
        question: input.topic.research_questions[2]!, answer_status: 'answered', gap_impact: 'none',
        answer: 'Use the bounded project-owned synthetic text task.', supporting_claim_ids: [], remaining_gap: '',
      };
      return call;
    };
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true, provider });
    expect(result.pack).toMatchObject({ status: 'success', decision: 'RESEARCH_INCOMPLETE', model: { calls: 3 } });
    expect(provider.experimentCalls).toEqual(['baseline_chat_request', 'structured_task_card']);
  });

  it('uses no more than four provider calls when research repair and two variants run', async () => {
    const repository = await root();
    const provider = new CountingFixtureProvider();
    const original = provider.analyze.bind(provider);
    provider.analyze = async (input) => {
      const call = await original(input);
      call.output.verified_claims[0]!.quote = 'bad once';
      return call;
    };
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true, provider });
    expect(result.pack).toMatchObject({ status: 'success', model: { calls: 4 } });
    expect(provider.experimentCalls).toEqual(['baseline_chat_request', 'structured_task_card']);
  });

  it('performs source acquisition before the idempotency decision', async () => {
    const repository = await root();
    const acquireSources = vi.fn(async (materials: Awaited<ReturnType<typeof loadFactSourceMaterials>>) =>
      buildFixtureResearchSources(materials).map((snapshot, index) => acquiredSnapshot(materials[index]!, snapshot)));
    await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', provider: new CountingFixtureProvider(), acquireSources });
    const secondProvider = new CountingFixtureProvider();
    const second = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', provider: secondProvider, acquireSources });
    expect(second.execution_status).toBe('ALREADY_RESEARCHED');
    expect(acquireSources).toHaveBeenCalledTimes(2);
    expect(secondProvider.analyzeCalls).toBe(0);
  });

  it('records analyze timeout as one attempted call', async () => {
    const repository = await root();
    const provider = new CountingFixtureProvider();
    provider.analyze = async () => { throw new ResearchProviderTimeoutError(); };
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true, provider });
    expect(result.pack).toMatchObject({ status: 'failed', error_code: 'codex_timeout', model: { calls: 1 } });
  });

  it('records repair timeout as the second attempted call', async () => {
    const repository = await root();
    const provider = new CountingFixtureProvider();
    const original = provider.analyze.bind(provider);
    provider.analyze = async (input) => {
      const call = await original(input);
      call.output.verified_claims[0]!.quote = 'invalid quote';
      return call;
    };
    provider.repair = async () => { throw new ResearchProviderTimeoutError(); };
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true, provider });
    expect(result.pack).toMatchObject({ status: 'failed', error_code: 'codex_timeout', model: { calls: 2 } });
  });

  it('records a structured variant timeout after analyze and baseline as three attempted calls', async () => {
    const repository = await root();
    const provider = new CountingFixtureProvider();
    const original = provider.runExperiment.bind(provider);
    provider.runExperiment = async (input) => {
      if (input.variant === 'structured_task_card') throw new ResearchProviderTimeoutError();
      return original(input);
    };
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true, provider });
    expect(result.pack).toMatchObject({ status: 'failed', error_code: 'codex_timeout', model: { calls: 3 } });
    expect(provider.experimentCalls).toEqual(['baseline_chat_request']);
  });
});
