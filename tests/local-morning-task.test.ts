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
import { browserMaterial, platformResult } from './opencli-test-helpers.js';

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

function pipeline(
  status: BrowserPipelineResult['status'],
  platformStatus: 'success' | 'command_failed' = 'success',
  date = '2026-08-14',
): BrowserPipelineResult {
  const platforms = [platformResult('twitter', []), platformResult('weixin', [])];
  for (const entry of platforms) entry.status = platformStatus;
  return {
    run_id: `browser_${date.replaceAll('-', '')}_${status}`, collection_date: date, dry_run: false,
    started_at: '2026-08-14T00:00:00.000Z', finished_at: '2026-08-14T00:00:01.000Z',
    preflight: { args: ['doctor'], status: 'success', exit_code: 0, duration_ms: 1, timed_out: false, cancelled: false, error: null },
    status, platforms, raw_materials_count: 0, materials_count: 0, duplicate_materials_count: 0,
  };
}

function dependencies(runPipeline = vi.fn(async () => pipeline('success'))) {
  return {
    healthCheck: vi.fn(async () => ({
      status: 'success', checks: [], error: null, platforms: { twitter: null, weixin: null },
    } as HealthCheckResult)),
    runPipeline,
    prepareRepository: vi.fn(async () => ({ status: 'ready', commit: null, recoveredCollectionDates: [] } as GitSyncResult)),
    syncData: vi.fn(async () => ({ status: 'no_changes', commit: null, recoveredCollectionDates: [] } as GitSyncResult)),
    writeReport: vi.fn(async () => '/tmp/report.md'),
    notify: vi.fn(async () => true),
  };
}

const now = new Date('2026-08-14T00:00:00.000Z');

function browserMaterialForPlatform(platform: 'twitter' | 'weixin') {
  return platform === 'twitter' ? browserMaterial() : browserMaterial({
    sourcePlatform: 'weixin',
    collector: 'opencli-weixin',
    sourceItemId: 'weixin-fixture',
    sourceUrl: 'https://mp.weixin.qq.com/s/stable-fixture',
    canonicalUrl: 'https://mp.weixin.qq.com/s/stable-fixture',
  });
}

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

  it('notifies once when the second failure reaches max attempts and stays quiet afterward', async () => {
    const env = await environment();
    const runPipeline = vi.fn(async () => pipeline('failed', 'command_failed'));
    const deps = dependencies(runPipeline);
    await runMorningTask({ ...env, now, config }, deps);
    await runMorningTask({ ...env, now, config }, deps);
    const third = await runMorningTask({ ...env, now, config }, deps);
    const fourth = await runMorningTask({ ...env, now, config }, deps);
    expect(third.outcome).toBe('MAX_ATTEMPTS_REACHED');
    expect(fourth.outcome).toBe('MAX_ATTEMPTS_REACHED');
    expect(runPipeline).toHaveBeenCalledTimes(2);
    expect(deps.notify).toHaveBeenCalledTimes(2);
    expect(deps.notify).toHaveBeenLastCalledWith('failed', 'Morning task reached 2 attempts', config);

    const outsideWindow = await runMorningTask({
      ...env, now: new Date('2026-08-14T04:01:00.000Z'), config, triggerMode: 'scheduled',
    }, deps);
    expect(outsideWindow.outcome).toBe('NOT_DUE');
    expect(deps.notify).toHaveBeenCalledTimes(2);

    await runMorningTask({ ...env, now: new Date('2026-08-15T00:00:00.000Z'), config }, deps);
    expect(runPipeline).toHaveBeenCalledTimes(3);
  });

  it('runs a manual dry-run at 14:00 without state, report, or Git writes', async () => {
    const env = await environment();
    const deps = dependencies();
    const execution = await runMorningTask({
      ...env,
      now: new Date('2026-08-14T06:00:00.000Z'),
      config,
      dryRun: true,
      triggerMode: 'manual',
    }, deps);
    expect(execution).toMatchObject({ outcome: 'COMPLETED', collected: true });
    expect(deps.healthCheck).toHaveBeenCalledTimes(1);
    expect(deps.healthCheck).toHaveBeenCalledWith(config, { platformProbes: false });
    expect(deps.runPipeline).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(deps.prepareRepository).not.toHaveBeenCalled();
    expect(deps.syncData).not.toHaveBeenCalled();
    expect(deps.writeReport).not.toHaveBeenCalled();
    await expect(access(env.paths.stateFile)).rejects.toThrow();
  });

  it('runs one formal manual task at 14:00 but does not repeat a completed day', async () => {
    const env = await environment();
    const deps = dependencies();
    const manual = {
      ...env,
      now: new Date('2026-08-14T06:00:00.000Z'),
      config,
      triggerMode: 'manual' as const,
    };
    expect((await runMorningTask(manual, deps)).outcome).toBe('COMPLETED');
    expect((await runMorningTask(manual, deps)).outcome).toBe('ALREADY_COMPLETED');
    expect(deps.runPipeline).toHaveBeenCalledTimes(1);
  });

  it('keeps the scheduled task not due at 14:00', async () => {
    const env = await environment();
    const deps = dependencies();
    const execution = await runMorningTask({
      ...env,
      now: new Date('2026-08-14T06:00:00.000Z'),
      config,
      triggerMode: 'scheduled',
    }, deps);
    expect(execution.outcome).toBe('NOT_DUE');
    expect(deps.healthCheck).not.toHaveBeenCalled();
    expect(deps.runPipeline).not.toHaveBeenCalled();
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
    deps.healthCheck.mockResolvedValue({
      status: 'unavailable', checks: [], error: 'Bridge unavailable', platforms: { twitter: null, weixin: null },
    });
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
    deps.prepareRepository.mockResolvedValueOnce({
      status: 'pending_pushed', commit: 'a'.repeat(40), recoveredCollectionDates: ['2026-08-14'],
    });
    const second = await runMorningTask({ ...env, now, config }, deps);
    expect(second).toMatchObject({ status: 'success', collected: false, gitCommit: 'a'.repeat(40) });
    expect(deps.runPipeline).toHaveBeenCalledTimes(1);
  });

  it('pushes a historical pending commit and still collects the current day', async () => {
    const env = await environment();
    const runPipeline = vi.fn()
      .mockResolvedValueOnce(pipeline('success', 'success', '2026-08-14'))
      .mockResolvedValueOnce(pipeline('success', 'success', '2026-08-15'));
    const deps = dependencies(runPipeline);
    deps.syncData.mockRejectedValueOnce(new GitSyncError('push failed', 'git_sync_failed'));

    const first = await runMorningTask({ ...env, now, config }, deps);
    expect(first).toMatchObject({ status: 'git_sync_failed', collected: true });
    deps.prepareRepository.mockResolvedValueOnce({
      status: 'pending_pushed', commit: 'b'.repeat(40), recoveredCollectionDates: ['2026-08-14'],
    });
    const second = await runMorningTask({
      ...env, now: new Date('2026-08-15T00:00:00.000Z'), config,
    }, deps);

    expect(second).toMatchObject({ status: 'success', collected: true, runId: 'browser_20260815_success' });
    expect(runPipeline).toHaveBeenCalledTimes(2);
    const state = await readSchedulerState(env.paths.stateFile);
    expect(state?.tasks.morning).toMatchObject({
      date: '2026-08-15', last_status: 'success', last_run_id: 'browser_20260815_success',
    });
  });

  it.each([
    ['login_required', 'weixin'],
    ['blocked', 'weixin'],
    ['blocked', 'twitter'],
  ] as const)('persists partial data when one platform is %s and %s succeeds', async (failedStatus, successfulPlatform) => {
    const env = await environment();
    const failedPlatform = successfulPlatform === 'weixin' ? 'twitter' : 'weixin';
    const failed = platformResult(failedPlatform, []);
    failed.status = failedStatus;
    const succeeded = platformResult(successfulPlatform, [browserMaterialForPlatform(successfulPlatform)]);
    const partial = pipeline('partial_success');
    partial.platforms = failedPlatform === 'twitter' ? [failed, succeeded] : [succeeded, failed];
    partial.materials_count = 1;
    partial.raw_materials_count = 1;
    const deps = dependencies(vi.fn(async () => partial));

    const execution = await runMorningTask({ ...env, now, config }, deps);
    expect(execution).toMatchObject({ status: 'partial_success', collected: true });
    expect(deps.writeReport).toHaveBeenCalledTimes(1);
    expect(deps.syncData).toHaveBeenCalledTimes(1);
  });

  it('commits WeChat partial success when X login fails with a normal no-ct0 error', async () => {
    const env = await environment();
    const twitter = platformResult('twitter', []);
    twitter.status = 'login_required';
    twitter.error = 'X login failed because no ct0 cookie was found';
    const weixin = platformResult('weixin', [browserMaterialForPlatform('weixin')]);
    const partial = pipeline('partial_success');
    partial.platforms = [twitter, weixin];
    partial.materials_count = 1;
    partial.raw_materials_count = 1;
    const deps = dependencies(vi.fn(async () => partial));
    deps.syncData.mockResolvedValueOnce({
      status: 'pushed', commit: 'c'.repeat(40), recoveredCollectionDates: [],
    });

    const execution = await runMorningTask({ ...env, now, config }, deps);
    expect(execution).toMatchObject({
      status: 'partial_success', collected: true, gitCommit: 'c'.repeat(40), runId: partial.run_id,
    });
    expect(deps.writeReport).toHaveBeenCalledWith(env.repositoryRoot, partial);
    expect(deps.syncData).toHaveBeenCalledWith(env.repositoryRoot, '2026-08-14', config);
    expect((await readSchedulerState(env.paths.stateFile))?.tasks.morning).toMatchObject({
      last_status: 'partial_success', last_collection_status: 'partial_success', last_run_id: partial.run_id,
    });
  });

  it('returns exit code 7 for an invalid staged path', async () => {
    const env = await environment();
    const deps = dependencies();
    deps.syncData.mockRejectedValueOnce(new GitSyncError('src change', 'invalid_staged_paths'));
    expect(await runMorningTask({ ...env, now, config }, deps)).toMatchObject({ status: 'git_sync_failed', exitCode: 7 });
  });

  it('does not access platforms when pending commit inspection fails', async () => {
    const env = await environment();
    const deps = dependencies();
    deps.prepareRepository.mockRejectedValueOnce(new GitSyncError('unsafe pending commit', 'invalid_staged_paths'));
    const execution = await runMorningTask({ ...env, now, config }, deps);
    expect(execution).toMatchObject({ status: 'git_sync_failed', exitCode: 7, collected: false });
    expect(deps.healthCheck).not.toHaveBeenCalled();
    expect(deps.runPipeline).not.toHaveBeenCalled();
  });
});
