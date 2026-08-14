import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeResearchInputHash } from '../src/research/input-hash.js';
import { runResearchBuild } from '../src/research/pipeline.js';
import { FixtureResearchProvider } from '../src/research/providers/fixture-research-provider.js';
import { ResearchProviderUnavailableError, type ResearchProviderInput } from '../src/research/providers/research-provider.js';
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
  it('advances SELECT_TOPIC to READY_FOR_WRITING in the offline fixture', async () => {
    const repository = await root();
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true });
    expect(result.pack).toMatchObject({ status: 'success', decision: 'READY_FOR_WRITING' });
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
    expect(researchPackSchema.parse(JSON.parse(await readFile(packPath, 'utf8'))).decision).toBe('READY_FOR_WRITING');
    await expect(stat(path.join(repository, 'reports/research/2026-08-14.md'))).resolves.toBeDefined();
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
    const first = await computeResearchInputHash({ ...common, sources: materials.map(({ material_id }) => ({ material_id, content_sha256: 'a'.repeat(64) })) });
    const second = await computeResearchInputHash({ ...common, sources: materials.map(({ material_id }, index) => ({ material_id, content_sha256: (index === 0 ? 'b' : 'a').repeat(64) })) });
    expect(first).not.toBe(second);
  });

  it('classifies source/network infrastructure failure as status=failed, not RESEARCH_INCOMPLETE', async () => {
    const repository = await root();
    const result = await runResearchBuild({
      rootDir: repository, researchDate: '2026-08-14', dryRun: true,
      provider: new CountingFixtureProvider(),
      fetchSource: async () => { throw new Error('simulated network failure'); },
    });
    expect(result.pack).toMatchObject({
      status: 'failed', decision: null, error_code: 'source_fetch_failed',
      source_summary: { requested: 2, fetched: 0, failed: 1, unsupported_content_type: 0 },
    });
  });

  it('classifies a Codex infrastructure error as status=failed', async () => {
    const repository = await root();
    const provider = new CountingFixtureProvider();
    provider.analyze = async () => { throw new ResearchProviderUnavailableError('codex_not_authenticated'); };
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true, provider });
    expect(result.pack).toMatchObject({ status: 'failed', decision: null, error_code: 'codex_not_authenticated' });
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
        question: input.topic.research_questions[0]!, answer_status: 'unanswered', answer: '', supporting_claim_ids: [], remaining_gap: 'Source does not answer this question.',
      };
      return call;
    };
    const result = await runResearchBuild({ rootDir: repository, researchDate: '2026-08-14', fixture: true, dryRun: true, provider });
    expect(result.pack).toMatchObject({ status: 'success', decision: 'RESEARCH_INCOMPLETE', readiness: { research_questions_sufficient: false } });
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
});
