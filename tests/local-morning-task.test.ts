import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BrowserPipelineResult } from '../src/browser-pipeline.js';
import { GitSyncError, type GitSyncResult } from '../src/local-runtime/git-sync.js';
import type { HealthCheckResult } from '../src/local-runtime/health-check.js';
import { loadLocalRuntimeConfig } from '../src/local-runtime/config.js';
import { runMorningTask } from '../src/local-runtime/morning-task.js';
import { createRuntimePaths } from '../src/local-runtime/paths.js';
import { readSchedulerState } from '../src/local-runtime/runtime-state.js';
import type { LocalRuntimeConfig } from '../src/local-runtime/types.js';
import { platformResult } from './opencli-test-helpers.js';

const roots: string[] = [];
let config: LocalRuntimeConfig;

beforeAll(async () => { config = await loadLocalRuntimeConfig(process.cwd()); });
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function environment() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'morning-task-home-'));
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'morning-task-repo-'));
  roots.push(home, repositoryRoot);
  return { repositoryRoot, paths: createRuntimePaths(home) };
}

function pipeline(status: BrowserPipelineResult['status'], platformStatus: 'success' | 'command_failed' = 'success'): BrowserPipelineResult {
  const platforms = [platformResult('twitter', []), platformResult('weixin', [])];
  for (const entry of platforms) entry.status = platformStatus;
  return {
    run_id: `browser_${status}`, collection_date: '2026-08-14', dry_run: false,
    started_at: '2026-08-14T00:00:00.000Z', finished_at: '2026-08-14T00:00:01.000Z',
    preflight: { args: ['doctor'], status: 'success', exit_code: 0, duration_ms: 1, timed_out: false, cancelled: false, error: null },
    status, platforms, raw_materials_count: 0, materials_count: 0, duplicate_materials_count: 0,
  };
}

function dependencies(runPipeline = vi.fn(async () => pipeline('success'))) {
  return {
    healthCheck: vi.fn(async () => ({ status: 'success', checks: [], error: null } as HealthCheckResult)),
    runPipeline,
    prepareRepository: vi.fn(async () => ({ status: 'ready', commit: null, skipCollection: false } as GitSyncResult)),
    syncData: vi.fn(async () => ({ status: 'no_changes', commit: null, skipCollection: false } as GitSyncResult)),
    writeReport: vi.fn(async () => '/tmp/report.md'),
    notify: vi.fn(async () => true),
  };
}

const now = new Date('2026-08-14T00:00:00.000Z');

describe('morning task orchestration', () => {
  it('persists success and does not collect twice on the same day', async () => {
    const env = await environment();
    const deps = dependencies();
    expect((await runMorningTask({ ...env, now, config }, deps)).status).toBe('success');
    expect((await runMorningTask({ ...env, now, config }, deps)).outcome).toBe('ALREADY_COMPLETED');
    expect(deps.runPipeline).toHaveBeenCalledTimes(1);
  });

  it('treats partial success as completed and emits a safe warning notification', async () => {
    const env = await environment();
    const deps = dependencies(vi.fn(async () => pipeline('partial_success')));
    const first = await runMorningTask({ ...env, now, config }, deps);
    const second = await runMorningTask({ ...env, now, config }, deps);
    expect(first.status).toBe('partial_success');
    expect(second.outcome).toBe('ALREADY_COMPLETED');
    expect(deps.notify).toHaveBeenCalledWith('partial_success', expect.any(String), config);
  });

  it('retries one failed pipeline inside the window', async () => {
    const env = await environment();
    const runPipeline = vi.fn()
      .mockResolvedValueOnce(pipeline('failed', 'command_failed'))
      .mockResolvedValueOnce(pipeline('success'));
    const deps = dependencies(runPipeline);
    expect((await runMorningTask({ ...env, now, config }, deps)).status).toBe('failed');
    expect((await runMorningTask({ ...env, now, config }, deps)).status).toBe('success');
    expect(runPipeline).toHaveBeenCalledTimes(2);
    expect((await readSchedulerState(env.paths.stateFile))?.tasks.morning.attempts).toBe(2);
  });

  it('stops after max attempts without a third platform visit', async () => {
    const env = await environment();
    const runPipeline = vi.fn(async () => pipeline('failed', 'command_failed'));
    const deps = dependencies(runPipeline);
    await runMorningTask({ ...env, now, config }, deps);
    await runMorningTask({ ...env, now, config }, deps);
    const third = await runMorningTask({ ...env, now, config }, deps);
    expect(third.outcome).toBe('MAX_ATTEMPTS_REACHED');
    expect(runPipeline).toHaveBeenCalledTimes(2);
  });

  it('releases the lock after an unexpected exception', async () => {
    const env = await environment();
    const runPipeline = vi.fn()
      .mockRejectedValueOnce(new Error('fixture crash'))
      .mockResolvedValueOnce(pipeline('success'));
    const deps = dependencies(runPipeline);
    expect((await runMorningTask({ ...env, now, config }, deps)).exitCode).toBe(1);
    await expect(access(env.paths.lockDirectory)).rejects.toThrow();
    expect((await runMorningTask({ ...env, now, config }, deps)).status).toBe('success');
  });

  it('does not invoke the Browser Pipeline after a failed health check', async () => {
    const env = await environment();
    const deps = dependencies();
    deps.healthCheck.mockResolvedValue({ status: 'unavailable', checks: [], error: 'Bridge unavailable' });
    const execution = await runMorningTask({ ...env, now, config }, deps);
    expect(execution).toMatchObject({ status: 'unavailable', exitCode: 3, collected: false });
    expect(deps.runPipeline).not.toHaveBeenCalled();
  });

  it('records a Git sync failure and next time pushes pending data without recollecting', async () => {
    const env = await environment();
    const deps = dependencies();
    deps.syncData.mockRejectedValueOnce(new GitSyncError('push failed', 'git_sync_failed'));
    const first = await runMorningTask({ ...env, now, config }, deps);
    expect(first).toMatchObject({ status: 'git_sync_failed', exitCode: 6, collected: true });
    deps.prepareRepository.mockResolvedValueOnce({ status: 'pending_pushed', commit: 'a'.repeat(40), skipCollection: true });
    const second = await runMorningTask({ ...env, now, config }, deps);
    expect(second).toMatchObject({ status: 'success', collected: false, gitCommit: 'a'.repeat(40) });
    expect(deps.runPipeline).toHaveBeenCalledTimes(1);
  });

  it('returns exit code 7 for an invalid staged path', async () => {
    const env = await environment();
    const deps = dependencies();
    deps.syncData.mockRejectedValueOnce(new GitSyncError('src change', 'invalid_staged_paths'));
    expect(await runMorningTask({ ...env, now, config }, deps)).toMatchObject({ status: 'git_sync_failed', exitCode: 7 });
  });
});
