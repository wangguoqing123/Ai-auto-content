import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFixtureSimpleWritingInput, loadSimpleWritingInput } from '../src/simple-writing/input.js';
import { runSimpleWritingBuild } from '../src/simple-writing/pipeline.js';
import {
  buildFixtureSimpleWriterOutput,
  FixtureSimpleWritingProvider,
} from '../src/simple-writing/provider.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function fixtureOutput() {
  const prepared = buildFixtureSimpleWritingInput('2026-08-14', 'ready');
  if (prepared.state !== 'ready') throw new Error('ready fixture required');
  return buildFixtureSimpleWriterOutput(prepared.input);
}

async function run(options: {
  scenario?: 'ready' | 'no-publish' | 'waiting' | 'no-sources';
  provider?: FixtureSimpleWritingProvider;
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'simple-writing-pipeline-'));
  roots.push(root);
  const provider = options.provider ?? new FixtureSimpleWritingProvider();
  const write = vi.spyOn(provider, 'write');
  const result = await runSimpleWritingBuild({
    rootDir: process.cwd(),
    writingDate: '2026-08-14',
    fixture: true,
    fixtureScenario: options.scenario ?? 'ready',
    dryRun: true,
    outputRoot: path.join(root, 'output'),
    now: new Date('2026-08-14T06:30:00.000Z'),
  }, { createProvider: () => provider });
  return { root, result, write };
}

describe('Simple Writing one-call pipeline', () => {
  it('loads the real Topic Decision references through the existing 72-hour material loader', async () => {
    const loaded = await loadSimpleWritingInput(process.cwd(), '2026-08-14');
    expect(loaded.state).toBe('ready');
    if (loaded.state !== 'ready') return;
    expect(loaded.input.topic.fact_source_ids).toEqual(['mat_e063daae6225', 'mat_9bafa93fe08b']);
    expect(loaded.input.materials.length).toBeGreaterThan(0);
    expect(loaded.input.materials.every(({ excerpt, canonical_url }) => excerpt.length > 0 && canonical_url.startsWith('http'))).toBe(true);
  });

  it('calls one Writer, returns READY_FOR_HUMAN_REVIEW, and writes exactly four files', async () => {
    const completed = await run();
    expect(completed.write).toHaveBeenCalledTimes(1);
    expect(completed.result.pack).toMatchObject({
      status: 'success', decision: 'READY_FOR_HUMAN_REVIEW',
      model: { provider: 'fixture', calls: 1 },
    });
    expect((await readdir(completed.result.output_directory ?? '')).sort()).toEqual([
      'article.md', 'review-notes.md', 'simple-writing-pack.json', 'sources.md',
    ]);
  });

  it.each([
    ['no-publish', 'NO_CONTENT'],
    ['waiting', 'WAITING_FOR_TOPIC'],
    ['no-sources', 'BLOCKED_NO_SOURCES'],
  ] as const)('%s returns %s with zero model calls', async (scenario, decision) => {
    const completed = await run({ scenario });
    expect(completed.result.pack).toMatchObject({ status: 'success', decision, model: { calls: 0 } });
    expect(completed.write).not.toHaveBeenCalled();
    expect(completed.result.files_written).toBe(false);
    await expect(access(path.join(completed.root, 'output'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails invalid Writer output after one call without retrying', async () => {
    const completed = await run({ provider: new FixtureSimpleWritingProvider({ primary_title: '' }) });
    expect(completed.write).toHaveBeenCalledTimes(1);
    expect(completed.result.pack).toMatchObject({
      status: 'failed', decision: null, error_code: 'output_schema_invalid', model: { calls: 1 },
    });
    expect(completed.result.files_written).toBe(false);
  });

  it('hard-fails a Writer source ID that was not in the input', async () => {
    const output = { ...fixtureOutput(), used_source_ids: ['mat_999999999999'] };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack).toMatchObject({ status: 'failed', error_code: 'unknown_source_id', model: { calls: 1 } });
  });

  it('hard-fails an external URL that was not in the input', async () => {
    const base = fixtureOutput();
    const output = { ...base, article_markdown: `${base.article_markdown}\n\nhttps://unknown.example/new-fact` };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack).toMatchObject({ status: 'failed', error_code: 'unknown_external_url' });
  });

  it.each(['我实测', '365 元'])('keeps the draft ready but warns on %s', async (phrase) => {
    const base = fixtureOutput();
    const output = { ...base, article_markdown: `${base.article_markdown}\n\n${phrase}只用于测试 warning。` };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack.decision).toBe('READY_FOR_HUMAN_REVIEW');
    expect(completed.result.pack.checks?.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'basic_safety', code: 'high_risk_phrase' }),
    ]));
  });

  it('keeps a short article as a warning instead of blocking the draft', async () => {
    const output = { ...fixtureOutput(), article_markdown: '这是一个合成短草稿，只验证长度 warning。' };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack.decision).toBe('READY_FOR_HUMAN_REVIEW');
    expect(completed.result.pack.checks?.warnings).toContainEqual(expect.objectContaining({ code: 'article_short' }));
  });

  it('hard-fails a local absolute path', async () => {
    const base = fixtureOutput();
    const output = { ...base, article_markdown: `${base.article_markdown}\n\n/Users/example/private.txt` };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack).toMatchObject({ status: 'failed', error_code: 'local_absolute_path' });
  });

  it('records one call and never retries when the Writer throws', async () => {
    const completed = await run({ provider: new FixtureSimpleWritingProvider(undefined, 'codex_timeout') });
    expect(completed.write).toHaveBeenCalledTimes(1);
    expect(completed.result.pack).toMatchObject({ status: 'failed', decision: null, error_code: 'codex_timeout', model: { calls: 1 } });
  });

  it('does not call the Writer when the daily attempt marker cannot be saved', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'simple-writing-attempt-state-'));
    roots.push(root);
    const provider = new FixtureSimpleWritingProvider();
    const write = vi.spyOn(provider, 'write');
    const result = await runSimpleWritingBuild({
      rootDir: process.cwd(), writingDate: '2026-08-14', fixture: true, dryRun: true,
      outputRoot: path.join(root, 'output'),
    }, {
      createProvider: () => provider,
      beforeProviderCall: async () => { throw new Error('state unavailable'); },
    });
    expect(result.pack).toMatchObject({ status: 'failed', error_code: 'attempt_state_write_failed', model: { calls: 0 } });
    expect(write).not.toHaveBeenCalled();
  });

  it('always preserves the Human Gate and disallows automated publishing', async () => {
    const completed = await run();
    expect(completed.result.pack.human_gate).toEqual({
      required: true, status: 'unreviewed', automated_publish_allowed: false,
    });
  });
});
