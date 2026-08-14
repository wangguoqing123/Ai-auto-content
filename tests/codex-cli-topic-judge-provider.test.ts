import { chmod, copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadTopicIntelligenceConfig } from '../src/topic-intelligence/config.js';
import { loadTopicProductTruth } from '../src/topic-intelligence/product-context.js';
import {
  CodexCliProviderError,
  CodexCliTopicJudgeProvider,
} from '../src/topic-intelligence/providers/codex-cli-topic-judge-provider.js';
import { buildFixtureMaterialInput } from '../src/topic-intelligence/providers/fixture-topic-judge-provider.js';
import { topicJudgeProviderResultSchema } from '../src/topic-intelligence/schemas.js';
import type { TopicJudgeInput } from '../src/topic-intelligence/providers/topic-judge-provider.js';

const roots: string[] = [];
const fixture = path.join(process.cwd(), 'tests', 'fixtures', 'fake-codex.mjs');
let input: TopicJudgeInput;

beforeAll(async () => {
  const [config, product] = await Promise.all([
    loadTopicIntelligenceConfig(process.cwd()),
    loadTopicProductTruth(process.cwd()),
  ]);
  input = {
    decisionDate: '2026-08-14',
    materials: buildFixtureMaterialInput().cards,
    productContext: product.context,
    recentTopics: [],
    config: { candidates: config.candidates, output: config.output },
  };
});

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function provider(model: string, options: { timeoutMs?: number; maxOutputBytes?: number; binPath?: string } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-provider-test-'));
  roots.push(root);
  return {
    root,
    provider: await CodexCliTopicJudgeProvider.create({
      binPath: options.binPath ?? fixture,
      model,
      tempRoot: path.join(root, 'topic-judge'),
      timeoutMs: options.timeoutMs ?? 2_000,
      maxOutputBytes: options.maxOutputBytes ?? 2 * 1024 * 1024,
      env: {
        HOME: os.homedir(),
        PATH: process.env.PATH,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        TERM: 'dumb',
        OPENAI_API_KEY: 'must-not-pass',
        GH_TOKEN: 'must-not-pass',
        BROWSER_SESSION: 'must-not-pass',
      },
    }),
  };
}

describe('Codex CLI topic judge provider', () => {
  it.each([
    ['fake-select', 1],
    ['fake-no-publish', 0],
  ])('accepts strict %s output', async (model, candidates) => {
    const created = await provider(model);
    const call = await created.provider.judge(input);
    expect(topicJudgeProviderResultSchema.parse(call.output).candidates).toHaveLength(candidates);
    expect(call.usage).toEqual({ input_tokens: 10, output_tokens: 20, total_tokens: 30 });
    const calls = await readdir(path.join(created.root, 'topic-judge'));
    const files = await readdir(path.join(created.root, 'topic-judge', calls[0] ?? 'missing'));
    expect(files.sort()).toEqual(['input.json', 'output-schema.json', 'result.json', 'system-instructions.md']);
  });

  it('uses a path containing spaces without shell parsing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fake codex bin '));
    roots.push(root);
    const bin = path.join(root, 'fake codex');
    await copyFile(fixture, bin);
    await chmod(bin, 0o755);
    const created = await provider('fake-no-publish', { binPath: bin });
    await expect(created.provider.judge(input)).resolves.toMatchObject({ output: { candidates: [] } });
  });

  it('passes strict capability args, isolated cwd, and only minimal environment keys', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-runner-test-'));
    roots.push(root);
    const invocations: Array<{ args: readonly string[]; cwd?: string; env: NodeJS.ProcessEnv }> = [];
    const runner = async (_command: string, args: readonly string[], options: {
      cwd?: string; env: NodeJS.ProcessEnv; timeoutMs: number; maxOutputBytes: number;
    }) => {
      invocations.push({ args, ...(options.cwd === undefined ? {} : { cwd: options.cwd }), env: options.env });
      if (args[0] === '--version') return { exitCode: 0, stdout: 'codex-cli fake\n', stderr: '', timedOut: false, outputLimitExceeded: false };
      if (args[0] === '--help') return { exitCode: 0, stdout: '--ask-for-approval never\n', stderr: '', timedOut: false, outputLimitExceeded: false };
      if (args[0] === 'exec' && args[1] === '--help') return {
        exitCode: 0,
        stdout: 'Run Codex non-interactively --model --json --output-schema --output-last-message --sandbox read-only\n',
        stderr: '', timedOut: false, outputLimitExceeded: false,
      };
      if (args[0] === 'login') return { exitCode: 0, stdout: '', stderr: '', timedOut: false, outputLimitExceeded: false };
      const output = args[args.indexOf('--output-last-message') + 1] ?? '';
      await writeFile(output, JSON.stringify({
        candidates: [], no_publish_reason_code: 'weak_user_value', no_publish_reason: 'fixture',
      }));
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, outputLimitExceeded: false };
    };
    const created = await CodexCliTopicJudgeProvider.create({
      binPath: fixture,
      model: 'fixture-model',
      tempRoot: path.join(root, 'topic-judge'),
      env: {
        HOME: os.homedir(), PATH: process.env.PATH, LANG: 'en_US.UTF-8', TERM: 'dumb',
        OPENAI_API_KEY: 'secret', GITHUB_TOKEN: 'secret', Cookie: 'secret',
      },
      processRunner: runner,
    });
    await created.judge(input);
    const invocation = invocations.at(-1);
    expect(invocation?.args).toEqual(expect.arrayContaining([
      '--ask-for-approval', 'never', 'exec', '--model', 'fixture-model', '--sandbox', 'read-only',
      '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--output-schema', '--json', '--output-last-message',
    ]));
    expect(invocation?.cwd).toMatch(/topic-judge\/topic_/);
    expect(Object.keys(invocation?.env ?? {}).sort()).toEqual(['HOME', 'LANG', 'PATH', 'TERM']);
  });

  it('returns a repairable invalid marker and succeeds on the second call', async () => {
    const created = await provider('fake-repair');
    expect(topicJudgeProviderResultSchema.safeParse((await created.provider.judge(input)).output).success).toBe(false);
    expect(topicJudgeProviderResultSchema.safeParse((await created.provider.repair(input, ['candidates invalid'])).output).success).toBe(true);
  });

  it.each(['fake-invalid', 'fake-fence', 'fake-large', 'fake-outside-write', 'fake-schema-exit'])('rejects unsafe or invalid %s output', async (model) => {
    const created = await provider(model, model === 'fake-large' ? { maxOutputBytes: 64 * 1024 } : {});
    const call = await created.provider.judge(input);
    expect(call.output).toEqual({ __provider_error: 'codex_output_invalid' });
    await expect(readdir(created.root)).resolves.toEqual(['topic-judge']);
  });

  it('treats injection text as data and never exposes secrets', async () => {
    const created = await provider('fake-injection');
    const parsed = topicJudgeProviderResultSchema.parse((await created.provider.judge(input)).output);
    expect(parsed.no_publish_reason).not.toMatch(/api key|must-not-pass/i);
  });

  it('classifies timeout, rate limit, process failure, and missing authentication', async () => {
    await expect((await provider('fake-timeout', { timeoutMs: 25 })).provider.judge(input)).rejects.toMatchObject({ name: 'TopicJudgeTimeoutError' });
    await expect((await provider('fake-rate-limit')).provider.judge(input)).rejects.toMatchObject({ code: 'codex_rate_limited' });
    await expect((await provider('fake-exit')).provider.judge(input)).rejects.toMatchObject({ code: 'codex_process_failed' });

    const root = await mkdtemp(path.join(os.tmpdir(), 'fake-codex-unauth-'));
    roots.push(root);
    const unauth = path.join(root, 'fake-codex-unauth');
    await copyFile(fixture, unauth);
    await chmod(unauth, 0o755);
    await expect(CodexCliTopicJudgeProvider.create({
      binPath: unauth, model: 'fake-no-publish', env: { HOME: os.homedir(), PATH: process.env.PATH },
    })).rejects.toEqual(expect.objectContaining<Partial<CodexCliProviderError>>({ code: 'codex_not_authenticated' }));
  });
});
