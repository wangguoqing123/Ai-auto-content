import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { OpenCliRunner, toCommandSummary, type SpawnOpenCli } from '../src/collectors/opencli/opencli-runner.js';

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => {
    queueMicrotask(() => this.emit('close', null));
    return true;
  });
}

function spawned(stdout: string, stderr: string, exitCode: number): { fake: FakeChild; spawn: SpawnOpenCli } {
  const fake = new FakeChild();
  const spawn = vi.fn((_command: string, _args: readonly string[], _options: SpawnOptions) => {
    queueMicrotask(() => {
      if (stdout) fake.stdout.write(stdout);
      if (stderr) fake.stderr.write(stderr);
      fake.stdout.end();
      fake.stderr.end();
      fake.emit('close', exitCode);
    });
    return fake as unknown as ChildProcess;
  });
  return { fake, spawn };
}

describe('OpenCLI runner', () => {
  it('passes user input as a spawn argument array with shell disabled', async () => {
    const process = spawned('[]', '', 0);
    const runner = new OpenCliRunner(process.spawn);
    const query = 'AI workflow; touch /tmp/must-not-run';
    await runner.run(['twitter', 'search', query, '-f', 'json']);
    expect(process.spawn).toHaveBeenCalledWith('opencli', ['twitter', 'search', query, '-f', 'json'], expect.objectContaining({ shell: false }));
  });

  it('terminates a timed out process', async () => {
    const fake = new FakeChild();
    const runner = new OpenCliRunner(() => fake as unknown as ChildProcess, 5);
    const result = await runner.run(['twitter', 'search', 'AI', '-f', 'json']);
    expect(result.timed_out).toBe(true);
    expect(result.status).toBe('command_failed');
    expect(fake.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('reports JSON parsing failures explicitly', async () => {
    const process = spawned('not-json', '', 0);
    const result = await new OpenCliRunner(process.spawn).run(['twitter', 'search', 'AI', '-f', 'json']);
    expect(result.status).toBe('command_failed');
    expect(result.error).toContain('JSON parse failed');
  });

  it('cancels a running command through AbortSignal', async () => {
    const fake = new FakeChild();
    const controller = new AbortController();
    const running = new OpenCliRunner(() => fake as unknown as ChildProcess).run(
      ['twitter', 'search', 'AI', '-f', 'json'],
      { signal: controller.signal },
    );
    controller.abort();
    const result = await running;
    expect(result.cancelled).toBe(true);
    expect(fake.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('recognizes login expiry', async () => {
    const process = spawned('', 'AUTH_REQUIRED Not logged into x.com (no ct0 cookie)', 77);
    const result = await new OpenCliRunner(process.spawn).run(['twitter', 'search', 'AI', '-f', 'json']);
    expect(result.status).toBe('login_required');
  });

  it('recognizes security blocks', async () => {
    const process = spawned('', 'SECURITY_BLOCK Xiaohongshu security block: risk control', 1);
    const result = await new OpenCliRunner(process.spawn).run(['xiaohongshu', 'search', 'AI工具', '-f', 'json']);
    expect(result.status).toBe('blocked');
  });

  it('redacts temporary platform access URLs from persisted command summaries', () => {
    const summary = toCommandSummary({
      args: ['xiaohongshu', 'note', 'https://www.xiaohongshu.com/search_result/64f123456789abcdef123456?xsec_token=secret'],
      status: 'command_failed', exit_code: 1, duration_ms: 1, timed_out: false, cancelled: false,
      error: 'failed https://weixin.sogou.com/link?signature=secret&pass_ticket=hidden',
      stdout: '', stderr: '', data: null,
    });
    expect(JSON.stringify(summary)).not.toMatch(/secret|hidden|xsec_token/);
    expect(summary.args[2]).toBe('https://www.xiaohongshu.com/explore/64f123456789abcdef123456');
  });
});
