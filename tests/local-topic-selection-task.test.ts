import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadLocalRuntimeConfig } from '../src/local-runtime/config.js';
import type { GitSyncResult } from '../src/local-runtime/git-sync.js';
import { createRuntimePaths } from '../src/local-runtime/paths.js';
import { readSchedulerState } from '../src/local-runtime/runtime-state.js';
import { runTopicSelectionTask } from '../src/local-runtime/topic-selection-task.js';
import type { LocalRuntimeConfig } from '../src/local-runtime/types.js';
import { runTopicSelection, type RunTopicSelectionResult } from '../src/topic-intelligence/pipeline.js';

const roots: string[] = [];
let config: LocalRuntimeConfig;
let fixtureSelection: RunTopicSelectionResult;

beforeAll(async () => {
  config = await loadLocalRuntimeConfig(process.cwd());
  fixtureSelection = await runTopicSelection({
    decisionDate: '2026-08-14', fixture: true, dryRun: true, fixtureMode: 'no-publish',
  });
});
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function environment() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'topic-task-home-'));
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'topic-task-repo-'));
  roots.push(home, repositoryRoot);
  return { repositoryRoot, paths: createRuntimePaths(home) };
}

function dependencies(selection: RunTopicSelectionResult = { ...fixtureSelection, files_written: true }) {
  return {
    runSelection: vi.fn(async () => selection),
    prepareRepository: vi.fn(async () => ({
      status: 'ready', commit: null, recoveredCollectionDates: [], recoveredTopicDecisionDates: [],
    } as GitSyncResult)),
    syncData: vi.fn(async () => ({
      status: 'pushed', commit: 'a'.repeat(40), recoveredCollectionDates: [], recoveredTopicDecisionDates: [],
    } as GitSyncResult)),
    notify: vi.fn(async () => true),
  };
}

const due = new Date('2026-08-14T05:00:00.000Z');

describe('local topic selection task', () => {
  it('runs in the 13:00 window and treats NO_PUBLISH as completed', async () => {
    const env = await environment();
    const deps = dependencies();
    const first = await runTopicSelectionTask({ ...env, now: due, config }, deps);
    const second = await runTopicSelectionTask({ ...env, now: due, config }, deps);
    expect(first).toMatchObject({ outcome: 'COMPLETED', status: 'success', topicDecision: 'NO_PUBLISH' });
    expect(second.outcome).toBe('ALREADY_COMPLETED');
    expect(deps.runSelection).toHaveBeenCalledTimes(1);
    expect((await readSchedulerState(env.paths.stateFile))?.tasks.topic_selection).toMatchObject({
      attempts: 1, last_status: 'success', last_topic_decision: 'NO_PUBLISH',
    });
  });

  it('does not invoke selection outside 13:00-18:00', async () => {
    const env = await environment();
    const deps = dependencies();
    const execution = await runTopicSelectionTask({
      ...env, now: new Date('2026-08-14T04:59:00.000Z'), config,
    }, deps);
    expect(execution.outcome).toBe('NOT_DUE');
    expect(deps.runSelection).not.toHaveBeenCalled();
  });

  it('passes fixture dry-run through without state or Git changes', async () => {
    const env = await environment();
    const deps = dependencies({ ...fixtureSelection, files_written: false });
    const execution = await runTopicSelectionTask({ ...env, now: due, config, dryRun: true, fixture: true }, deps);
    expect(execution).toMatchObject({ status: 'success', modelCalls: 1 });
    expect(deps.runSelection).toHaveBeenCalledWith(expect.objectContaining({
      decisionDate: '2026-08-14', dryRun: true, fixture: true,
    }));
    expect(deps.prepareRepository).not.toHaveBeenCalled();
    expect(deps.syncData).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
    await expect(access(env.paths.stateFile)).rejects.toThrow();
  });

  it('counts failed runs and stops after two attempts', async () => {
    const env = await environment();
    const failed: RunTopicSelectionResult = {
      ...fixtureSelection,
      files_written: true,
      decision: {
        ...fixtureSelection.decision,
        status: 'failed',
        decision: null,
        selected_topic: null,
        no_publish_reason_code: null,
        no_publish_reason: null,
        error_code: 'model_unavailable',
        error_message_safe: 'Codex unavailable',
      },
    };
    const deps = dependencies(failed);
    expect((await runTopicSelectionTask({ ...env, now: due, config }, deps)).status).toBe('unavailable');
    expect((await runTopicSelectionTask({ ...env, now: due, config }, deps)).status).toBe('unavailable');
    expect((await runTopicSelectionTask({ ...env, now: due, config }, deps)).outcome).toBe('MAX_ATTEMPTS_REACHED');
    expect(deps.runSelection).toHaveBeenCalledTimes(2);
  });

  it('treats ALREADY_DECIDED as success without a new topic commit', async () => {
    const env = await environment();
    const deps = dependencies({ ...fixtureSelection, execution_status: 'ALREADY_DECIDED', files_written: false });
    const execution = await runTopicSelectionTask({ ...env, now: due, config }, deps);
    expect(execution).toMatchObject({ outcome: 'ALREADY_COMPLETED', status: 'success' });
    expect(deps.syncData).not.toHaveBeenCalled();
  });

  it('releases the topic lock after an unexpected error', async () => {
    const env = await environment();
    const deps = dependencies();
    deps.runSelection.mockRejectedValueOnce(new Error('fixture crash'));
    expect((await runTopicSelectionTask({ ...env, now: due, config }, deps)).status).toBe('failed');
    await expect(access(env.paths.lockDirectory)).rejects.toThrow();
  });
});
