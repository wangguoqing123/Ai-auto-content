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

  it('states the editorial contract and source-role permission boundaries', () => {
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('一篇文章只讲一个观点');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('内容不追求面面俱到');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('最多使用一个核心例子');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('删掉后不影响核心观点，就不要写');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('不主动补齐完整流程');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('700—1200 个中文字符');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('最多两个二级标题');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('观点讲清楚后立即结束');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('像在微信里给一个朋友讲清楚一个发现');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('fact_source 只能支持已保存摘录范围内的事实');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('trend_signal 只能说明出现了讨论或需求信号');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('不能作为事实来源');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('不虚构数字、经历、客户、学员、效果和产品权益');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('不自动写价格');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).toContain('供人工审核');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).not.toContain('标题和摘要的内容承诺必须兑现');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).not.toContain('包含目标、必要输入、执行步骤、交付物、验收标准、失败处理和人工确认边界');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).not.toContain('教程类文章至少展示原始模糊任务、改写后的任务、一个填写完成的模板或结果表格');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).not.toContain('为了满足合同而生成完整操作手册');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).not.toContain('RingCentral');
    expect(SIMPLE_WRITING_SYSTEM_PROMPT).not.toContain('别再只让 AI 给建议');
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

  it('throws a safe Provider error with Structured Runner metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'simple-writing-provider-invalid-'));
    roots.push(root);
    const provider = await CodexCliSimpleWritingProvider.create({
      binPath: fakeCodex,
      model: 'fake-simple-writing-schema-invalid',
      tempRoot: path.join(root, 'calls'),
      env: { HOME: os.homedir(), PATH: process.env.PATH },
    });
    await expect(provider.write(input())).rejects.toMatchObject({
      name: 'SimpleWritingProviderError',
      code: 'codex_output_invalid',
      safeMessage: 'codex_output_invalid: schema_validation_failed:primary_title:too_big',
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });
    await expect(readdir(path.join(root, 'calls'))).resolves.toHaveLength(1);
  });
});
