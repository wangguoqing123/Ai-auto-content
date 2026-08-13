import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OpenCliRunner, OpenCliRunResult } from '../src/collectors/opencli/opencli-runner.js';
import { loadLocalRuntimeConfig } from '../src/local-runtime/config.js';
import { parseDoctorOutput, runHealthCheck } from '../src/local-runtime/health-check.js';
import type { CommandResult } from '../src/local-runtime/process.js';
import type { LocalRuntimeConfig } from '../src/local-runtime/types.js';
import { commandResult } from './opencli-test-helpers.js';

const roots: string[] = [];
let config: LocalRuntimeConfig;

beforeAll(async () => { config = await loadLocalRuntimeConfig(process.cwd()); });
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function command(command: string, args: readonly string[], stdout: string): CommandResult {
  return { command, args: [...args], exitCode: 0, stdout, stderr: '', timedOut: false };
}

function sharedExecute(commandName: string, args: readonly string[]): Promise<CommandResult> {
  const stdout = commandName === 'npm' ? '10.0.0\n'
    : commandName === 'opencli' ? 'opencli 1.8.6\n'
      : '123\n';
  return Promise.resolve(command(commandName, args, stdout));
}

function doctor(args: readonly string[]): OpenCliRunResult {
  return {
    ...commandResult(args, 'success', null),
    stdout: 'Daemon: OK\nExtension: connected\nConnectivity: OK\n',
  };
}

describe('OpenCLI doctor output parsing', () => {
  it('requires all three positive diagnostics', () => {
    expect(parseDoctorOutput('Daemon: OK\nExtension: connected\nConnectivity: OK')).toEqual({
      daemon: true, extension: true, connectivity: true,
    });
  });

  it('does not trust a successful process when Extension is disconnected', () => {
    expect(parseDoctorOutput('Daemon: OK\nExtension: not connected\nConnectivity: failed')).toEqual({
      daemon: true, extension: false, connectivity: false,
    });
  });

  it('does not infer missing diagnostics from an exit code or generic text', () => {
    expect(parseDoctorOutput('Everything looks fine')).toEqual({ daemon: false, extension: false, connectivity: false });
  });

  it('treats missing platform adapters as platform-local instead of shared-health blockers', async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), 'health-check-home-'));
    roots.push(homeDirectory);
    const calls: string[][] = [];
    const runner = { run: async (args: readonly string[]) => {
      calls.push([...args]);
      return doctor(args);
    } } as unknown as OpenCliRunner;
    const result = await runHealthCheck(config, {
      execute: sharedExecute,
      openCliRunner: runner,
      homeDirectory,
      platformProbes: false,
    });
    expect(result.status).toBe('success');
    expect(result.platforms).toEqual({ twitter: null, weixin: null });
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'twitter_adapter', ok: false }),
      expect.objectContaining({ name: 'weixin_adapter', ok: false }),
    ]));
    expect(calls).toEqual([['doctor']]);
  });

  it('probes WeChat even after X login failure and reports both platform states independently', async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), 'health-check-home-'));
    roots.push(homeDirectory);
    const calls: string[][] = [];
    const runner = { run: async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === 'doctor') return doctor(args);
      if (args[0] === 'twitter') return commandResult(args, 'login_required', null, 'Not logged in');
      return commandResult(args, 'success', []);
    } } as unknown as OpenCliRunner;
    const result = await runHealthCheck(config, {
      execute: sharedExecute,
      openCliRunner: runner,
      homeDirectory,
    });
    expect(calls.map((args) => args[0])).toEqual(['doctor', 'twitter', 'weixin']);
    expect(result.platforms).toEqual({ twitter: 'login_required', weixin: 'success' });
    expect(result.status).toBe('login_required');
  });
});
