import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodexProcessRunner } from '../src/local-agent/codex-structured-runner.js';
import { CodexCliWritingProvider, FixtureWritingProvider, WritingProviderError } from '../src/writing/provider.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function providerFor(output: unknown): Promise<CodexCliWritingProvider> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-writing-provider-'));
  roots.push(root);
  const processRunner: CodexProcessRunner = async (_command, args) => {
    if (args[0] === '--version') return { exitCode: 0, stdout: 'codex-cli fake\n', stderr: '', timedOut: false, outputLimitExceeded: false };
    if (args[0] === '--help') return { exitCode: 0, stdout: '--ask-for-approval never\n', stderr: '', timedOut: false, outputLimitExceeded: false };
    if (args[0] === 'exec' && args[1] === '--help') return {
      exitCode: 0,
      stdout: 'Run Codex non-interactively --model --json --output-schema --output-last-message --sandbox read-only\n',
      stderr: '', timedOut: false, outputLimitExceeded: false,
    };
    if (args[0] === 'login') return { exitCode: 0, stdout: 'Logged in\n', stderr: '', timedOut: false, outputLimitExceeded: false };
    const resultPath = args[args.indexOf('--output-last-message') + 1]!;
    await writeFile(resultPath, JSON.stringify(output), { mode: 0o600 });
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } })}\n`,
      stderr: '', timedOut: false, outputLimitExceeded: false,
    };
  };
  return CodexCliWritingProvider.create({
    model: 'fake-writing', binPath: process.execPath, tempRoot: path.join(root, 'provider'),
    env: { HOME: os.homedir(), PATH: process.env.PATH, LANG: 'en_US.UTF-8', TERM: 'dumb' },
    processRunner,
  });
}

describe('Codex CLI Writing Provider', () => {
  it('normalizes one-based X IDs before returning the internal Writer Output', async () => {
    const fixture = (await new FixtureWritingProvider().write({ x_format: 'thread' })).output;
    const oneBased = structuredClone(fixture);
    oneBased.x.thread.items.forEach((unit, index) => { unit.unit_id = `x.thread.${index + 1}`; });
    const call = await (await providerFor(oneBased)).write({ synthetic: true });
    expect(call.output.x.thread.items.map(({ unit_id }) => unit_id)).toEqual(
      call.output.x.thread.items.map((_unit, index) => `x.thread.${index}`),
    );
    expect(call.usage).toEqual({ input_tokens: 100, output_tokens: 20, total_tokens: 120 });
  });

  it('returns only paths and issue codes in schema diagnostics', async () => {
    const fixture = (await new FixtureWritingProvider().write({ x_format: 'thread' })).output;
    const invalid = structuredClone(fixture) as unknown as { primary_title: { text: unknown } };
    invalid.primary_title.text = 42;
    try {
      await (await providerFor(invalid)).write({ synthetic: true });
      throw new Error('expected provider failure');
    } catch (error) {
      expect(error).toBeInstanceOf(WritingProviderError);
      expect(error).toMatchObject({
        code: 'codex_output_invalid',
        safeMessage: expect.stringContaining('schema_validation_failed:primary_title.text:invalid_type'),
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      });
      expect((error as WritingProviderError).safeMessage).not.toContain('42');
    }
  });
});
