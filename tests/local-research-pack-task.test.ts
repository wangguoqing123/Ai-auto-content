import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLocalRuntimeConfig } from '../src/local-runtime/config.js';
import { createRuntimePaths } from '../src/local-runtime/paths.js';
import { runResearchPackTask } from '../src/local-runtime/research-pack-task.js';
import { createEmptyState, readSchedulerState, writeSchedulerState } from '../src/local-runtime/runtime-state.js';
import { runResearchBuild } from '../src/research/pipeline.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function environment(topic: 'valid' | 'missing' | 'no-publish' = 'valid') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-task-'));
  roots.push(root);
  const repository = path.join(root, 'repository');
  const home = path.join(root, 'home');
  await mkdir(repository, { recursive: true });
  await cp(path.join(process.cwd(), 'config'), path.join(repository, 'config'), { recursive: true });
  await cp(path.join(process.cwd(), 'data', 'materials'), path.join(repository, 'data', 'materials'), { recursive: true });
  if (topic !== 'missing') {
    await mkdir(path.join(repository, 'data', 'topic-decisions'), { recursive: true });
    const decision = JSON.parse(await readFile(path.join(process.cwd(), 'data/topic-decisions/2026-08-14.json'), 'utf8')) as Record<string, unknown>;
    if (topic === 'no-publish') {
      decision.decision = 'NO_PUBLISH'; decision.selected_topic = null;
      decision.no_publish_reason_code = 'weak_user_value'; decision.no_publish_reason = 'No topic.';
    }
    await writeFile(path.join(repository, 'data/topic-decisions/2026-08-14.json'), `${JSON.stringify(decision, null, 2)}\n`);
  }
  const config = await loadLocalRuntimeConfig(repository);
  config.git_sync.enabled = false;
  const paths = createRuntimePaths(home);
  return { root, repository, home, config, paths };
}

describe('local Research Pack scheduler task', () => {
  it('is NOT_DUE at 13:29 Asia/Shanghai', async () => {
    const env = await environment();
    const result = await runResearchPackTask({
      repositoryRoot: env.repository, now: new Date('2026-08-14T05:29:00.000Z'), fixture: true, dryRun: true,
      config: env.config, paths: env.paths, triggerMode: 'scheduled',
    });
    expect(result).toMatchObject({ outcome: 'NOT_DUE', status: 'not_due', exitCode: 0 });
  });

  it('is DUE at the 13:30 boundary', async () => {
    const env = await environment();
    const result = await runResearchPackTask({
      repositoryRoot: env.repository, now: new Date('2026-08-14T05:30:00.000Z'), fixture: true, dryRun: true,
      config: env.config, paths: env.paths, triggerMode: 'scheduled',
    });
    expect(result).toMatchObject({ outcome: 'COMPLETED', status: 'success', researchDecision: 'RESEARCH_INCOMPLETE' });
  });

  it('is DUE at the inclusive 21:00 boundary', async () => {
    const env = await environment();
    const result = await runResearchPackTask({
      repositoryRoot: env.repository, now: new Date('2026-08-14T13:00:00.000Z'), fixture: true, dryRun: true,
      config: env.config, paths: env.paths, triggerMode: 'scheduled',
    });
    expect(result.status).toBe('success');
  });

  it('is NOT_DUE at 21:01 Asia/Shanghai', async () => {
    const env = await environment();
    const result = await runResearchPackTask({
      repositoryRoot: env.repository, now: new Date('2026-08-14T13:01:00.000Z'), fixture: true, dryRun: true,
      config: env.config, paths: env.paths, triggerMode: 'scheduled',
    });
    expect(result.outcome).toBe('NOT_DUE');
  });

  it('returns WAITING_FOR_TOPIC without creating or incrementing state', async () => {
    const env = await environment('missing');
    const result = await runResearchPackTask({
      repositoryRoot: env.repository, now: new Date('2026-08-14T05:30:00.000Z'), fixture: true,
      config: env.config, paths: env.paths, triggerMode: 'scheduled',
    });
    expect(result).toMatchObject({ outcome: 'WAITING_FOR_TOPIC', status: 'waiting_for_topic', exitCode: 0 });
    await expect(stat(env.paths.stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('maps Topic NO_PUBLISH to completed NO_TOPIC with zero model calls', async () => {
    const env = await environment('no-publish');
    const result = await runResearchPackTask({
      repositoryRoot: env.repository, now: new Date('2026-08-14T05:30:00.000Z'), fixture: true,
      config: env.config, paths: env.paths, triggerMode: 'scheduled',
    });
    expect(result).toMatchObject({ outcome: 'COMPLETED', researchDecision: 'NO_TOPIC', modelCalls: 0 });
  });

  it('returns ALREADY_RESEARCHED after the successful daily task state is complete', async () => {
    const env = await environment();
    const options = {
      repositoryRoot: env.repository, now: new Date('2026-08-14T05:30:00.000Z'), fixture: true,
      config: env.config, paths: env.paths, triggerMode: 'scheduled' as const,
    };
    expect((await runResearchPackTask(options)).outcome).toBe('COMPLETED');
    expect((await runResearchPackTask(options)).outcome).toBe('ALREADY_RESEARCHED');
  });

  it('preserves Morning and Topic task state when updating Research state', async () => {
    const env = await environment();
    const state = createEmptyState('2026-08-14');
    state.tasks.morning.last_status = 'partial_success';
    state.tasks.morning.attempts = 1;
    state.tasks.topic_selection.last_status = 'success';
    state.tasks.topic_selection.last_topic_decision = 'SELECT_TOPIC';
    await writeSchedulerState(env.paths.stateFile, state);
    await runResearchPackTask({
      repositoryRoot: env.repository, now: new Date('2026-08-14T05:30:00.000Z'), fixture: true,
      config: env.config, paths: env.paths, triggerMode: 'scheduled',
    });
    const updated = await readSchedulerState(env.paths.stateFile);
    expect(updated?.tasks.morning).toMatchObject({ last_status: 'partial_success', attempts: 1 });
    expect(updated?.tasks.topic_selection).toMatchObject({ last_status: 'success', last_topic_decision: 'SELECT_TOPIC' });
    expect(updated?.tasks.research_pack).toMatchObject({ last_status: 'success', last_research_decision: 'RESEARCH_INCOMPLETE' });
  });

  it('increments attempts for a real research failure and preserves its safe error', async () => {
    const env = await environment();
    const notify = vi.fn(async () => true);
    const template = (await runResearchBuild({
      rootDir: env.repository, researchDate: '2026-08-14', fixture: true, dryRun: true,
    })).pack;
    const result = await runResearchPackTask({
      repositoryRoot: env.repository, now: new Date('2026-08-14T05:30:00.000Z'), fixture: true,
      config: env.config, paths: env.paths, triggerMode: 'scheduled',
    }, {
      notify,
      runResearch: async () => ({
        execution_status: 'RESEARCHED', files_written: false,
        pack: {
          ...template,
          status: 'failed', decision: null, error_code: 'codex_timeout', error_message_safe: 'Codex timed out.',
        },
      }),
    });
    expect(result).toMatchObject({ outcome: 'FAILED', status: 'unavailable', exitCode: 3 });
    expect((await readSchedulerState(env.paths.stateFile))?.tasks.research_pack).toMatchObject({ attempts: 1, last_error: 'Codex timed out.' });
  });

  it('stops after the configured maximum attempts', async () => {
    const env = await environment();
    const state = createEmptyState('2026-08-14');
    state.tasks.research_pack.attempts = 2;
    state.tasks.research_pack.last_status = 'failed';
    await writeSchedulerState(env.paths.stateFile, state);
    const result = await runResearchPackTask({
      repositoryRoot: env.repository, now: new Date('2026-08-14T05:30:00.000Z'), fixture: true,
      config: env.config, paths: env.paths, triggerMode: 'scheduled',
    });
    expect(result).toMatchObject({ outcome: 'MAX_ATTEMPTS_REACHED', exitCode: 0 });
  });
});
