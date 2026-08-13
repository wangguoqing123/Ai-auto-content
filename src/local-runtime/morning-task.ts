import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { runBrowserPipeline, type BrowserPipelineOptions, type BrowserPipelineResult } from '../browser-pipeline.js';
import type { BrowserPlatformResult } from '../collectors/opencli/opencli-capability.js';
import { loadLocalRuntimeConfig } from './config.js';
import { commitAndPushBrowserData, GitSyncError, prepareRuntimeRepository, type GitSyncResult } from './git-sync.js';
import { runHealthCheck, type HealthCheckResult } from './health-check.js';
import { sendLocalNotification } from './notification.js';
import { createRuntimePaths } from './paths.js';
import { writeBrowserReport } from './report.js';
import { acquireRuntimeLock, type RuntimeLock } from './runtime-lock.js';
import { createEmptyState, readSchedulerState, writeSchedulerState } from './runtime-state.js';
import { scheduleDecision, type TriggerMode } from './schedule-window.js';
import type {
  CompletedCollectionStatus,
  LocalRuntimeConfig,
  RuntimeExecutionResult,
  RuntimePaths,
  RuntimeTaskStatus,
  SchedulerState,
} from './types.js';

export interface MorningTaskOptions {
  repositoryRoot: string;
  now?: Date;
  dryRun?: boolean;
  fixture?: boolean;
  paths?: RuntimePaths;
  config?: LocalRuntimeConfig;
  triggerMode?: TriggerMode;
}

export interface MorningTaskDependencies {
  readState?: typeof readSchedulerState;
  writeState?: typeof writeSchedulerState;
  acquireLock?: typeof acquireRuntimeLock;
  healthCheck?: (config: LocalRuntimeConfig) => Promise<HealthCheckResult>;
  runPipeline?: (options: BrowserPipelineOptions) => Promise<BrowserPipelineResult>;
  prepareRepository?: (root: string, config: LocalRuntimeConfig) => Promise<GitSyncResult>;
  syncData?: (root: string, date: string, config: LocalRuntimeConfig) => Promise<GitSyncResult>;
  writeReport?: typeof writeBrowserReport;
  notify?: typeof sendLocalNotification;
}

function result(
  outcome: RuntimeExecutionResult['outcome'],
  status: RuntimeTaskStatus,
  exitCode: number,
  date: string,
  options: Partial<Pick<RuntimeExecutionResult, 'runId' | 'error' | 'collected' | 'gitCommit'>> = {},
): RuntimeExecutionResult {
  return {
    outcome,
    status,
    exitCode,
    date,
    runId: options.runId ?? null,
    error: options.error ?? null,
    collected: options.collected ?? false,
    gitCommit: options.gitCommit ?? null,
  };
}

function pipelineFailure(resultValue: BrowserPipelineResult): { status: RuntimeTaskStatus; exitCode: number; error: string } {
  const statuses = resultValue.platforms.map((platform) => platform.status);
  if (statuses.includes('blocked')) return { status: 'blocked', exitCode: 5, error: 'Browser platform blocked' };
  if (statuses.includes('login_required')) return { status: 'login_required', exitCode: 4, error: 'Browser platform login required' };
  if (statuses.every((status) => status === 'unavailable')) return { status: 'unavailable', exitCode: 2, error: 'Browser platforms unavailable' };
  return { status: 'failed', exitCode: 2, error: 'Browser Pipeline failed' };
}

function healthFailure(resultValue: HealthCheckResult): { status: RuntimeTaskStatus; exitCode: number } {
  if (resultValue.status === 'blocked') return { status: 'blocked', exitCode: 5 };
  if (resultValue.status === 'login_required') return { status: 'login_required', exitCode: 4 };
  if (resultValue.status === 'unavailable') return { status: 'unavailable', exitCode: 3 };
  return { status: 'failed', exitCode: 3 };
}

function fixtureHealth(): HealthCheckResult {
  return {
    status: 'success',
    checks: [
      { name: 'fixture_environment', ok: true, detail: 'offline fixture' },
      { name: 'platform_access', ok: true, detail: 'not accessed' },
    ],
    error: null,
  };
}

function fixturePlatform(platform: BrowserPlatformResult['platform'], now: Date): BrowserPlatformResult {
  return {
    platform,
    status: 'success',
    started_at: now.toISOString(),
    finished_at: now.toISOString(),
    commands: [],
    materials: [],
    raw_materials_count: 0,
    materials_count: 0,
    duplicate_materials_count: 0,
    missing_fields: [],
    error: null,
  };
}

export function createFixtureBrowserResult(now: Date, date: string): BrowserPipelineResult {
  return {
    run_id: `browser_fixture_${date.replaceAll('-', '')}`,
    collection_date: date,
    dry_run: true,
    started_at: now.toISOString(),
    finished_at: now.toISOString(),
    preflight: {
      args: ['fixture'], status: 'success', exit_code: 0, duration_ms: 0,
      timed_out: false, cancelled: false, error: null,
    },
    status: 'success',
    platforms: [fixturePlatform('twitter', now), fixturePlatform('weixin', now)],
    raw_materials_count: 0,
    materials_count: 0,
    duplicate_materials_count: 0,
  };
}

async function logEvent(paths: RuntimePaths, dryRun: boolean, event: Record<string, unknown>): Promise<void> {
  if (dryRun) return;
  try {
    await mkdir(paths.logsDirectory, { recursive: true });
    await appendFile(path.join(paths.logsDirectory, 'runtime.jsonl'), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // launchd stdout/stderr remain the fallback log; logging must not mask the task result.
  }
}

function stateForDate(existing: SchedulerState | null, date: string): SchedulerState {
  return existing?.tasks.morning.date === date ? existing : createEmptyState(date);
}

export async function runMorningTask(
  options: MorningTaskOptions,
  dependencies: MorningTaskDependencies = {},
): Promise<RuntimeExecutionResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const paths = options.paths ?? createRuntimePaths();
  const config = options.config ?? await loadLocalRuntimeConfig(options.repositoryRoot, paths.configFile);
  const readState = dependencies.readState ?? readSchedulerState;
  const writeState = dependencies.writeState ?? writeSchedulerState;
  const lockFactory = dependencies.acquireLock ?? acquireRuntimeLock;
  const healthCheck = dependencies.healthCheck ?? runHealthCheck;
  const pipeline = dependencies.runPipeline ?? runBrowserPipeline;
  const prepareRepository = dependencies.prepareRepository ?? prepareRuntimeRepository;
  const syncData = dependencies.syncData ?? commitAndPushBrowserData;
  const reportWriter = dependencies.writeReport ?? writeBrowserReport;
  const notify = dependencies.notify ?? sendLocalNotification;
  const triggerMode = options.triggerMode ?? 'scheduled';
  let lock: RuntimeLock | null = null;
  let activeState: SchedulerState | null = null;
  let date = scheduleDecision(now, config, null, triggerMode).date;

  const notifyFailure = async (status: RuntimeTaskStatus, message: string): Promise<void> => {
    const reachedMaximum = (activeState?.tasks.morning.attempts ?? 0) >= config.morning.max_attempts;
    await notify(
      reachedMaximum ? 'failed' : status,
      reachedMaximum ? `Morning task reached ${config.morning.max_attempts} attempts` : message,
      config,
    );
  };

  try {
    const initialState = dryRun ? null : await readState(paths.stateFile);
    const initialDecision = scheduleDecision(now, config, initialState?.tasks.morning ?? null, triggerMode);
    date = initialDecision.date;
    if (initialDecision.decision === 'NOT_DUE') return result('NOT_DUE', 'not_due', 0, date);
    if (initialDecision.decision === 'ALREADY_COMPLETED') {
      return result('ALREADY_COMPLETED', initialState?.tasks.morning.last_status ?? 'success', 0, date);
    }
    if (initialDecision.decision === 'MAX_ATTEMPTS_REACHED') {
      return result('MAX_ATTEMPTS_REACHED', initialState?.tasks.morning.last_status ?? 'failed', 0, date);
    }

    lock = await lockFactory(paths.lockDirectory, 'morning', now, config.runtime.lock_stale_minutes);
    if (!lock.acquired) return result('LOCK_HELD', 'running', 0, date);

    const latestState = dryRun ? null : await readState(paths.stateFile);
    const lockedDecision = scheduleDecision(now, config, latestState?.tasks.morning ?? null, triggerMode);
    if (lockedDecision.decision !== 'DUE') {
      const status = lockedDecision.decision === 'ALREADY_COMPLETED'
        ? (latestState?.tasks.morning.last_status ?? 'success')
        : lockedDecision.decision === 'MAX_ATTEMPTS_REACHED'
          ? (latestState?.tasks.morning.last_status ?? 'failed')
          : 'not_due';
      return result(lockedDecision.decision, status, 0, date);
    }

    activeState = stateForDate(latestState, date);
    activeState.tasks.morning = {
      ...activeState.tasks.morning,
      attempts: activeState.tasks.morning.attempts + 1,
      last_attempt_at: now.toISOString(),
      last_status: 'running',
      last_error: null,
    };
    if (!dryRun) await writeState(paths.stateFile, activeState);
    await logEvent(paths, dryRun, { at: now.toISOString(), event: 'morning_started', date, stale_lock_recovered: lock.staleRecovered });

    if (!dryRun && config.git_sync.enabled) {
      let prepared: GitSyncResult;
      try {
        prepared = await prepareRepository(options.repositoryRoot, config);
      } catch (error) {
        const gitError = error instanceof GitSyncError ? error : new GitSyncError(error instanceof Error ? error.message : String(error), 'git_sync_failed');
        activeState.tasks.morning.last_status = 'git_sync_failed';
        activeState.tasks.morning.last_error = gitError.message;
        await writeState(paths.stateFile, activeState);
        await notifyFailure('git_sync_failed', gitError.message);
        return result('FAILED', 'git_sync_failed', gitError.kind === 'invalid_staged_paths' ? 7 : 6, date, { error: gitError.message });
      }
      if (prepared.skipCollection) {
        const completion = activeState.tasks.morning.last_collection_status ?? 'success';
        activeState.tasks.morning.last_status = completion;
        activeState.tasks.morning.last_error = null;
        if (!dryRun) await writeState(paths.stateFile, activeState);
        await notify(completion, 'Previously collected browser data was pushed successfully', config);
        return result('COMPLETED', completion, 0, date, { gitCommit: prepared.commit });
      }
    }

    const health = options.fixture ? fixtureHealth() : await healthCheck(config);
    if (health.status !== 'success') {
      const failure = healthFailure(health);
      activeState.tasks.morning.last_status = failure.status;
      activeState.tasks.morning.last_error = health.error;
      if (!dryRun) await writeState(paths.stateFile, activeState);
      await notifyFailure(failure.status, health.error ?? 'Local Browser runtime health check failed');
      return result('FAILED', failure.status, failure.exitCode, date, { error: health.error });
    }

    const browserResult = options.fixture
      ? createFixtureBrowserResult(now, date)
      : await pipeline({ rootDir: options.repositoryRoot, dryRun, now });
    if (browserResult.status === 'failed') {
      const failure = pipelineFailure(browserResult);
      activeState.tasks.morning.last_status = failure.status;
      activeState.tasks.morning.last_error = failure.error;
      activeState.tasks.morning.last_run_id = browserResult.run_id;
      if (!dryRun) await writeState(paths.stateFile, activeState);
      await notifyFailure(failure.status, failure.error);
      return result('FAILED', failure.status, failure.exitCode, date, {
        runId: browserResult.run_id, error: failure.error, collected: true,
      });
    }

    const collectionStatus: CompletedCollectionStatus = browserResult.status;
    let gitResult: GitSyncResult = { status: 'no_changes', commit: null, skipCollection: false };
    if (!dryRun) {
      await reportWriter(options.repositoryRoot, browserResult);
      try {
        gitResult = await syncData(options.repositoryRoot, date, config);
      } catch (error) {
        const gitError = error instanceof GitSyncError ? error : new GitSyncError(error instanceof Error ? error.message : String(error), 'git_sync_failed');
        activeState.tasks.morning.last_status = 'git_sync_failed';
        activeState.tasks.morning.last_collection_status = collectionStatus;
        activeState.tasks.morning.last_run_id = browserResult.run_id;
        activeState.tasks.morning.last_error = gitError.message;
        await writeState(paths.stateFile, activeState);
        await notifyFailure('git_sync_failed', gitError.message);
        return result('FAILED', 'git_sync_failed', gitError.kind === 'invalid_staged_paths' ? 7 : 6, date, {
          runId: browserResult.run_id, error: gitError.message, collected: true,
        });
      }
    }

    activeState.tasks.morning.last_status = collectionStatus;
    activeState.tasks.morning.last_collection_status = collectionStatus;
    activeState.tasks.morning.last_run_id = browserResult.run_id;
    activeState.tasks.morning.last_error = null;
    if (!dryRun) await writeState(paths.stateFile, activeState);
    await notify(collectionStatus, collectionStatus === 'partial_success' ? 'Browser collection completed with partial success' : 'Browser collection succeeded', config);
    await logEvent(paths, dryRun, { at: new Date().toISOString(), event: 'morning_completed', date, status: collectionStatus, run_id: browserResult.run_id });
    return result('COMPLETED', collectionStatus, 0, date, {
      runId: browserResult.run_id,
      collected: true,
      gitCommit: gitResult.commit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (activeState && !dryRun) {
      activeState.tasks.morning.last_status = 'failed';
      activeState.tasks.morning.last_error = message;
      try { await writeState(paths.stateFile, activeState); } catch { /* preserve the original error */ }
    }
    await logEvent(paths, dryRun, { at: new Date().toISOString(), event: 'morning_failed', date, error: message });
    await notifyFailure('failed', message);
    return result('FAILED', 'failed', 1, date, { error: message });
  } finally {
    await lock?.release();
  }
}
