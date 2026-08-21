import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFixtureSimpleWritingInput, loadSimpleWritingInput } from '../src/simple-writing/input.js';
import { runSimpleWritingBuild } from '../src/simple-writing/pipeline.js';
import {
  buildFixtureSimpleWriterOutput,
  FixtureSimpleWritingProvider,
  SimpleWritingProviderError,
  type SimpleWritingProvider,
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
  provider?: SimpleWritingProvider;
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
    expect(new Set(loaded.input.materials.map(({ source_role }) => source_role))).toEqual(new Set(['fact_source', 'trend_signal']));
  });

  it('preserves fact, trend, and structure source roles in Writer input', () => {
    const prepared = buildFixtureSimpleWritingInput('2026-08-14', 'ready');
    expect(prepared.state).toBe('ready');
    if (prepared.state !== 'ready') return;
    expect(prepared.input.materials.map(({ source_role }) => source_role)).toEqual([
      'fact_source', 'trend_signal', 'structure_inspiration',
    ]);
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

  it('preserves Provider Structured Output diagnostics, duration, and usage', async () => {
    const provider: SimpleWritingProvider = {
      providerName: 'codex_cli',
      modelName: 'gpt-5.6-sol',
      runtimeVersion: 'codex-cli fixture',
      write: async () => {
        throw new SimpleWritingProviderError(
          'codex_output_invalid',
          'codex_output_invalid: markdown_wrapper',
          1234,
          { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        );
      },
    };
    const completed = await run({ provider });
    expect(completed.write).toHaveBeenCalledTimes(1);
    expect(completed.result.pack).toMatchObject({
      status: 'failed',
      decision: null,
      output: null,
      checks: null,
      error_code: 'codex_output_invalid',
      error_message_safe: 'codex_output_invalid: markdown_wrapper',
      model: {
        provider: 'codex_cli', model: 'gpt-5.6-sol', calls: 1, duration_ms: 1234,
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      },
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

  it('hard-fails an unknown URL in the abstract and writes no success files', async () => {
    const output = { ...fixtureOutput(), abstract: '摘要引用了未知地址 https://unknown.example/abstract' };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack).toMatchObject({ status: 'failed', decision: null, error_code: 'unknown_external_url' });
    expect(completed.result.pack.checks?.hard_failures).toContainEqual(expect.objectContaining({
      code: 'unknown_external_url', message: expect.stringContaining('abstract'),
    }));
    expect(completed.result.files_written).toBe(false);
    await expect(access(path.join(completed.root, 'output'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('warns on a high-risk phrase in the primary title without blocking the draft', async () => {
    const output = { ...fixtureOutput(), primary_title: '我实测：把 AI 任务改成可验收流程' };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack.decision).toBe('READY_FOR_HUMAN_REVIEW');
    expect(completed.result.pack.checks?.warnings).toContainEqual(expect.objectContaining({
      code: 'high_risk_phrase', message: expect.stringContaining('primary_title'),
    }));
  });

  it('hard-fails a local path in an alternative title', async () => {
    const base = fixtureOutput();
    const output = { ...base, alternative_titles: ['/Users/example/private.txt', base.alternative_titles[1]] };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack).toMatchObject({ status: 'failed', decision: null, error_code: 'local_absolute_path' });
    expect(completed.result.pack.checks?.hard_failures).toContainEqual(expect.objectContaining({
      code: 'local_absolute_path', message: expect.stringContaining('alternative_title_0'),
    }));
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

  it('warns at 499 Chinese characters without blocking the draft', async () => {
    const output = {
      ...fixtureOutput(),
      primary_title: '题'.repeat(60),
      alternative_titles: ['备'.repeat(60), '选'.repeat(60)],
      abstract: '摘'.repeat(300),
      article_markdown: '文'.repeat(499),
    };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack.decision).toBe('READY_FOR_HUMAN_REVIEW');
    expect(completed.result.pack.checks?.warnings).toContainEqual(expect.objectContaining({
      code: 'article_short', message: expect.stringContaining('499'),
    }));
  });

  it.each([500, 1_500])('does not warn on length at %i Chinese characters', async (count) => {
    const output = { ...fixtureOutput(), article_markdown: '文'.repeat(count) };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack.decision).toBe('READY_FOR_HUMAN_REVIEW');
    expect(completed.result.pack.checks?.warnings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'article_short' }),
      expect.objectContaining({ code: 'article_long' }),
    ]));
  });

  it('warns at 1501 Chinese characters without blocking the draft', async () => {
    const output = { ...fixtureOutput(), article_markdown: '文'.repeat(1_501) };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack.decision).toBe('READY_FOR_HUMAN_REVIEW');
    expect(completed.result.pack.checks?.warnings).toContainEqual(expect.objectContaining({
      code: 'article_long', message: expect.stringContaining('1501'),
    }));
  });

  it('warns but stays ready when a promised task card has no copyable artifact', async () => {
    const base = fixtureOutput();
    const output = {
      ...base,
      primary_title: '给你一张可以复用的任务执行卡',
      alternative_titles: ['把任务说明写具体', '从需求走到验收结果'],
      abstract: '解释怎样定义一个可以检查的任务。',
      article_markdown: '这是一篇只有解释段落、没有代码块、表格或勾选清单的合成正文。',
    };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack.decision).toBe('READY_FOR_HUMAN_REVIEW');
    expect(completed.result.pack.checks?.warnings).toContainEqual(expect.objectContaining({
      category: 'basic_format', code: 'promised_artifact_missing',
    }));
    expect(await readFile(completed.result.files?.reviewNotes ?? '', 'utf8')).toContain('promised_artifact_missing');
  });

  it('accepts a promised task card with a fenced Markdown template', async () => {
    const base = fixtureOutput();
    const output = {
      ...base,
      primary_title: '一张可直接复制的任务执行卡',
      alternative_titles: ['把任务写成可验收结果', '从输入走到人工确认'],
      abstract: '正文提供完整模板。',
      article_markdown: `下面是完整模板：

\`\`\`markdown
# 任务执行卡
- 目标：
- 必要输入：
- 执行步骤：
- 交付物：
- 验收标准：
- 失败处理：
- 人工确认边界：
\`\`\``,
    };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack.checks?.warnings).not.toContainEqual(expect.objectContaining({ code: 'promised_artifact_missing' }));
  });

  it('accepts a promised checklist with at least three Markdown checkboxes', async () => {
    const base = fixtureOutput();
    const output = {
      ...base,
      primary_title: '任务验收清单',
      alternative_titles: ['检查任务输入', '检查任务结果'],
      abstract: '提供一份可以勾选的检查项。',
      article_markdown: '- [ ] 输入资料完整\n- [ ] 交付物字段齐全\n- [ ] 人工确认边界明确',
    };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack.checks?.warnings).not.toContainEqual(expect.objectContaining({ code: 'promised_artifact_missing' }));
  });

  it('accepts a promised table with a Markdown header separator', async () => {
    const base = fixtureOutput();
    const output = {
      ...base,
      primary_title: '用一张表格检查任务结果',
      alternative_titles: ['检查负责人和时间', '暴露待确认信息'],
      abstract: '正文给出结果表格。',
      article_markdown: '| 待办 | 负责人 | 状态 |\n|---|---|---|\n| 整理清单 | 李明 | 通过 |',
    };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack.checks?.warnings).not.toContainEqual(expect.objectContaining({ code: 'promised_artifact_missing' }));
  });

  it('does not require an artifact when titles and abstract make no artifact promise', async () => {
    const base = fixtureOutput();
    const output = {
      ...base,
      primary_title: '先把任务范围说清楚',
      alternative_titles: ['输入不足时先停下来', '怎样暴露待确认信息'],
      abstract: '解释任务定义为什么影响最终结果。',
      article_markdown: '这是一篇普通说明文章，没有承诺提供独立成品。',
    };
    const completed = await run({ provider: new FixtureSimpleWritingProvider(output) });
    expect(completed.result.pack.checks?.warnings).not.toContainEqual(expect.objectContaining({ code: 'promised_artifact_missing' }));
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
