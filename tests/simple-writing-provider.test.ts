import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildFixtureSimpleWritingInput } from '../src/simple-writing/input.js';
import {
  CodexCliSimpleWritingProvider,
  FixtureSimpleWritingProvider,
  SIMPLE_WRITING_SYSTEM_PROMPT,
  simpleWritingProviderSettingsFromEnvironment,
} from '../src/simple-writing/provider.js';

const roots: string[] = [];
const fakeCodex = path.join(process.cwd(), 'tests', 'fixtures', 'fake-codex.mjs');
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function input() {
  const prepared = buildFixtureSimpleWritingInput('2026-08-14', 'ready');
  if (prepared.state !== 'ready') throw new Error('ready fixture required');
  return prepared.input;
}

describe('Simple Writing providers', () => {
  it('exposes only write and has no review or repair methods', () => {
    const provider = new FixtureSimpleWritingProvider();
    expect(typeof provider.write).toBe('function');
    expect('review' in provider).toBe(false);
    expect('repair' in provider).toBe(false);
  });

  it('uses Simple Writing env first, Writing env as fallback, and gpt-5.6-sol by default', () => {
    expect(simpleWritingProviderSettingsFromEnvironment({
      SIMPLE_WRITING_CODEX_BIN: '/simple/codex', SIMPLE_WRITING_CODEX_MODEL: 'simple-model',
      WRITING_CODEX_BIN: '/writing/codex', WRITING_CODEX_MODEL: 'writing-model',
    })).toEqual({ binPath: '/simple/codex', model: 'simple-model' });
    expect(simpleWritingProviderSettingsFromEnvironment({
      WRITING_CODEX_BIN: '/writing/codex', WRITING_CODEX_MODEL: 'writing-model',
    })).toEqual({ binPath: '/writing/codex', model: 'writing-model' });
    expect(simpleWritingProviderSettingsFromEnvironment({})).toEqual({ model: 'gpt-5.6-sol' });
  });

  it('states the fact, trend-signal, and structure-inspiration permission boundaries', () => {
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('只能支持与已保存摘录范围一致的事实陈述');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('单条信号不能证明普遍事实、行业趋势或确定结论');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('不能作为事实来源');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('不得因为多个材料表达相似，就推断它们必然正确');
  });

  it('reuses the Structured Runner for one valid Codex CLI Writer call', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'simple-writing-provider-'));
    roots.push(root);
    const provider = await CodexCliSimpleWritingProvider.create({
      binPath: fakeCodex,
      model: 'fake-simple-writing',
      tempRoot: path.join(root, 'calls'),
      env: { HOME: os.homedir(), PATH: process.env.PATH, LANG: 'en_US.UTF-8', TERM: 'dumb' },
    });
    const call = await provider.write(input());
    expect(call.output).toMatchObject({ primary_title: '把 AI 任务改成可验收流程' });
    expect(call.usage).toEqual({ input_tokens: 10, output_tokens: 20, total_tokens: 30 });
    const directories = await readdir(path.join(root, 'calls'));
    const callDirectory = path.join(root, 'calls', directories[0] ?? 'missing');
    expect((await readdir(callDirectory)).sort()).toEqual([
      'input.json', 'output-schema.json', 'result.json', 'system-instructions.md',
    ]);
    const schema = JSON.parse(await readFile(path.join(callDirectory, 'output-schema.json'), 'utf8')) as Record<string, unknown>;
    expect(JSON.stringify(schema)).not.toContain('prefixItems');
    const writtenInput = JSON.parse(await readFile(path.join(callDirectory, 'input.json'), 'utf8')) as {
      materials: Array<{ source_role: string }>;
    };
    expect(writtenInput.materials.map(({ source_role }) => source_role)).toEqual([
      'fact_source', 'trend_signal', 'structure_inspiration',
    ]);
  });

  it('turns invalid Structured Runner output into one invalid result for the pipeline to hard-fail', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'simple-writing-provider-invalid-'));
    roots.push(root);
    const provider = await CodexCliSimpleWritingProvider.create({
      binPath: fakeCodex,
      model: 'fake-invalid',
      tempRoot: path.join(root, 'calls'),
      env: { HOME: os.homedir(), PATH: process.env.PATH },
    });
    await expect(provider.write(input())).resolves.toMatchObject({
      output: { __provider_error: 'codex_output_invalid' },
    });
    await expect(readdir(path.join(root, 'calls'))).resolves.toHaveLength(1);
  });
});
