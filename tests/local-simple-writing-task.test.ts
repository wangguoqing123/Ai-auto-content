import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLocalRuntimeConfig } from '../src/local-runtime/config.js';
import { createRuntimePaths } from '../src/local-runtime/paths.js';
import {
  readSimpleWritingRuntimeState,
  runSimpleWritingTask,
} from '../src/local-runtime/simple-writing-task.js';
import { runSimpleWritingBuild } from '../src/simple-writing/pipeline.js';
import { FixtureSimpleWritingProvider } from '../src/simple-writing/provider.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function environment() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-simple-writing-'));
  roots.push(root);
  return {
    root,
    paths: createRuntimePaths(path.join(root, 'home')),
    config: await loadLocalRuntimeConfig(process.cwd()),
    outputRoot: path.join(root, 'review'),
  };
}

function fixtureScenario(scenario: 'ready' | 'no-publish' | 'waiting' | 'no-sources') {
  return (options: Parameters<typeof runSimpleWritingBuild>[0], dependencies?: Parameters<typeof runSimpleWritingBuild>[1]) => runSimpleWritingBuild({
    ...options,
    fixture: true,
    fixtureScenario: scenario,
  }, dependencies);
}

describe('local Simple Writing scheduler task', () => {
  it('is NOT_DUE at 14:29 Asia/Shanghai', async () => {
    const env = await environment();
    const result = await runSimpleWritingTask({
      repositoryRoot: process.cwd(), now: new Date('2026-08-14T06:29:00.000Z'),
      fixture: true, dryRun: true, paths: env.paths, config: env.config,
      outputRoot: env.outputRoot, triggerMode: 'scheduled',
    });
    expect(result).toMatchObject({ outcome: 'NOT_DUE', status: 'not_due', modelCalls: 0 });
  });

  it('runs one Fixture Writer at the inclusive 14:30 boundary and records the minimal state', async () => {
    const env = await environment();
    const result = await runSimpleWritingTask({
      repositoryRoot: process.cwd(), now: new Date('2026-08-14T06:30:00.000Z'),
      fixture: true, dryRun: true, paths: env.paths, config: env.config,
      outputRoot: env.outputRoot, triggerMode: 'scheduled',
    });
    expect(result).toMatchObject({
      outcome: 'COMPLETED', status: 'success', writingDecision: 'READY_FOR_HUMAN_REVIEW', modelCalls: 1,
    });
    const state = await readSimpleWritingRuntimeState(path.join(env.paths.stateDirectory, 'simple-writing-state.json'));
    expect(Object.keys(state ?? {}).sort()).toEqual([
      'date', 'error_code', 'model_attempted', 'model_calls', 'output_directory', 'status', 'updated_at',
    ]);
    expect(state).toMatchObject({ status: 'ready_for_human_review', model_attempted: true, model_calls: 1, error_code: null });
  });

  it('maps NO_PUBLISH to NO_CONTENT with zero model calls', async () => {
    const env = await environment();
    const result = await runSimpleWritingTask({
      repositoryRoot: process.cwd(), now: new Date('2026-08-14T06:30:00.000Z'),
      fixture: true, dryRun: true, paths: env.paths, config: env.config,
      outputRoot: env.outputRoot, triggerMode: 'scheduled',
    }, { runWriting: fixtureScenario('no-publish') });
    expect(result).toMatchObject({ outcome: 'COMPLETED', writingDecision: 'NO_CONTENT', modelCalls: 0 });
  });

  it('keeps WAITING_FOR_TOPIC retryable without calling the model', async () => {
    const env = await environment();
    const runWriting = vi.fn(fixtureScenario('waiting'));
    const options = {
      repositoryRoot: process.cwd(), now: new Date('2026-08-14T06:30:00.000Z'),
      fixture: true, dryRun: true, paths: env.paths, config: env.config,
      outputRoot: env.outputRoot, triggerMode: 'scheduled' as const,
    };
    expect(await runSimpleWritingTask(options, { runWriting })).toMatchObject({ outcome: 'WAITING_FOR_TOPIC', modelCalls: 0 });
    expect(await runSimpleWritingTask(options, { runWriting })).toMatchObject({ outcome: 'WAITING_FOR_TOPIC', modelCalls: 0 });
    expect(runWriting).toHaveBeenCalledTimes(2);
  });

  it('maps an empty source set to BLOCKED_NO_SOURCES without calling the model', async () => {
    const env = await environment();
    const result = await runSimpleWritingTask({
      repositoryRoot: process.cwd(), now: new Date('2026-08-14T06:30:00.000Z'),
      fixture: true, dryRun: true, paths: env.paths, config: env.config,
      outputRoot: env.outputRoot, triggerMode: 'scheduled',
    }, { runWriting: fixtureScenario('no-sources') });
    expect(result).toMatchObject({ outcome: 'BLOCKED_NO_SOURCES', status: 'blocked', modelCalls: 0 });
  });

  it('never makes a second Writer attempt on the same day after a model failure', async () => {
    const env = await environment();
    const runWriting = vi.fn((
      options: Parameters<typeof runSimpleWritingBuild>[0],
      dependencies?: Parameters<typeof runSimpleWritingBuild>[1],
    ) => runSimpleWritingBuild({
      ...options,
      fixture: true,
    }, {
      ...dependencies,
      createProvider: () => new FixtureSimpleWritingProvider(undefined, 'codex_timeout'),
    }));
    const options = {
      repositoryRoot: process.cwd(), now: new Date('2026-08-14T06:30:00.000Z'),
      fixture: true, dryRun: true, paths: env.paths, config: env.config,
      outputRoot: env.outputRoot, triggerMode: 'scheduled' as const,
    };
    expect(await runSimpleWritingTask(options, { runWriting })).toMatchObject({ outcome: 'FAILED', modelCalls: 1 });
    expect(await runSimpleWritingTask(options, { runWriting })).toMatchObject({ outcome: 'ALREADY_COMPLETED', modelCalls: 1 });
    expect(runWriting).toHaveBeenCalledTimes(1);
  });

  it('is NOT_DUE after the inclusive 22:00 window', async () => {
    const env = await environment();
    const result = await runSimpleWritingTask({
      repositoryRoot: process.cwd(), now: new Date('2026-08-14T14:01:00.000Z'),
      fixture: true, dryRun: true, paths: env.paths, config: env.config,
      outputRoot: env.outputRoot, triggerMode: 'scheduled',
    });
    expect(result.outcome).toBe('NOT_DUE');
  });
});
