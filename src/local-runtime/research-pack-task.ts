import { runResearchBuild, type RunResearchBuildResult } from '../research/pipeline.js';
import { readExistingTopicDecision } from '../topic-intelligence/storage.js';
import { loadLocalRuntimeConfig } from './config.js';
import { commitAndPushResearchData, GitSyncError, prepareRuntimeRepository, type GitSyncResult } from './git-sync.js';
import { sendLocalNotification } from './notification.js';
import { createRuntimePaths } from './paths.js';
import { acquireRuntimeLock, type RuntimeLock } from './runtime-lock.js';
import { createEmptyState, readSchedulerState, writeSchedulerState } from './runtime-state.js';
import { scheduleDecision, type TriggerMode } from './schedule-window.js';
import type {
  LocalRuntimeConfig,
  RuntimeExecutionResult,
  RuntimePaths,
  RuntimeTaskStatus,
  SchedulerState,
} from './types.js';

export interface ResearchPackTaskOptions {
  repositoryRoot: string;
  now?: Date;
  dryRun?: boolean;
  fixture?: boolean;
  paths?: RuntimePaths;
  config?: LocalRuntimeConfig;
  triggerMode?: TriggerMode;
}

export interface ResearchPackTaskDependencies {
  readState?: typeof readSchedulerState;
  writeState?: typeof writeSchedulerState;
  acquireLock?: typeof acquireRuntimeLock;
  runResearch?: typeof runResearchBuild;
  prepareRepository?: (root: string, config: LocalRuntimeConfig) => Promise<GitSyncResult>;
  syncData?: (root: string, date: string, config: LocalRuntimeConfig) => Promise<GitSyncResult>;
  notify?: typeof sendLocalNotification;
}

function result(
  outcome: RuntimeExecutionResult['outcome'],
  status: RuntimeTaskStatus,
  exitCode: number,
  date: string,
  options: Partial<Pick<RuntimeExecutionResult, 'runId' | 'error' | 'gitCommit' | 'researchDecision' | 'modelCalls'>> = {},
): RuntimeExecutionResult {
  return {
    outcome, status, exitCode, date,
    runId: options.runId ?? null,
    error: options.error ?? null,
    collected: false,
    gitCommit: options.gitCommit ?? null,
    task: 'research_pack',
    researchDecision: options.researchDecision ?? null,
    modelCalls: options.modelCalls ?? 0,
  };
}

function stateForDate(existing: SchedulerState | null, date: string): SchedulerState {
  if (existing === null) return createEmptyState(date);
  if (existing.tasks.research_pack.date === date) return existing;
  return {
    ...existing,
    tasks: { ...existing.tasks, research_pack: createEmptyState(date).tasks.research_pack },
  };
}

function failureStatus(run: RunResearchBuildResult): { status: RuntimeTaskStatus; exitCode: number } {
  const code = run.pack.error_code ?? '';
  if (/codex_|source_fetch/.test(code)) return { status: 'unavailable', exitCode: 3 };
  return { status: 'failed', exitCode: 4 };
}

export async function runResearchPackTask(
  options: ResearchPackTaskOptions,
  dependencies: ResearchPackTaskDependencies = {},
): Promise<RuntimeExecutionResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const paths = options.paths ?? createRuntimePaths();
  const config = options.config ?? await loadLocalRuntimeConfig(options.repositoryRoot, paths.configFile);
  const readState = dependencies.readState ?? readSchedulerState;
  const writeState = dependencies.writeState ?? writeSchedulerState;
  const lockFactory = dependencies.acquireLock ?? acquireRuntimeLock;
  const research = dependencies.runResearch ?? runResearchBuild;
  const prepare = dependencies.prepareRepository ?? prepareRuntimeRepository;
  const sync = dependencies.syncData ?? commitAndPushResearchData;
  const notify = dependencies.notify ?? sendLocalNotification;
  const triggerMode = options.triggerMode ?? 'scheduled';
  let lock: RuntimeLock | null = null;
  let activeState: SchedulerState | null = null;
  let date = scheduleDecision(now, config, null, triggerMode, 'research_pack').date;

  const notifyFailure = async (status: RuntimeTaskStatus, message: string): Promise<void> => {
    if (dryRun) return;
    const reachedMaximum = (activeState?.tasks.research_pack.attempts ?? 0) >= config.research_pack.max_attempts;
    await notify(
      reachedMaximum ? 'failed' : status,
      reachedMaximum ? `Research Pack reached ${config.research_pack.max_attempts} attempts` : message,
      config,
    );
  };

  try {
    const initialState = dryRun ? null : await readState(paths.stateFile);
    const initial = scheduleDecision(now, config, initialState?.tasks.research_pack ?? null, triggerMode, 'research_pack');
    date = initial.date;
    if (initial.decision === 'NOT_DUE') return result('NOT_DUE', 'not_due', 0, date);
    if (initial.decision === 'ALREADY_COMPLETED') {
      return result('ALREADY_RESEARCHED', 'success', 0, date, {
        runId: initialState?.tasks.research_pack.last_run_id || null,
        researchDecision: initialState?.tasks.research_pack.last_research_decision ?? null,
      });
    }
    if (initial.decision === 'MAX_ATTEMPTS_REACHED') {
      return result('MAX_ATTEMPTS_REACHED', initialState?.tasks.research_pack.last_status ?? 'failed', 0, date);
    }
    const topicBeforeLock = await readExistingTopicDecision(options.repositoryRoot, date);
    if (topicBeforeLock.state === 'absent') return result('WAITING_FOR_TOPIC', 'waiting_for_topic', 0, date);

    lock = await lockFactory(paths.lockDirectory, 'research_pack', now, config.runtime.lock_stale_minutes);
    if (!lock.acquired) return result('LOCK_HELD', 'running', 0, date);

    const latestState = dryRun ? null : await readState(paths.stateFile);
    const lockedDecision = scheduleDecision(now, config, latestState?.tasks.research_pack ?? null, triggerMode, 'research_pack');
    if (lockedDecision.decision !== 'DUE') {
      const status = lockedDecision.decision === 'ALREADY_COMPLETED'
        ? 'success'
        : lockedDecision.decision === 'MAX_ATTEMPTS_REACHED'
          ? (latestState?.tasks.research_pack.last_status ?? 'failed')
          : 'not_due';
      return result(lockedDecision.decision === 'ALREADY_COMPLETED' ? 'ALREADY_RESEARCHED' : lockedDecision.decision, status, 0, date);
    }
    const topic = await readExistingTopicDecision(options.repositoryRoot, date);
    if (topic.state === 'absent') return result('WAITING_FOR_TOPIC', 'waiting_for_topic', 0, date);

    activeState = stateForDate(latestState, date);
    activeState.tasks.research_pack = {
      ...activeState.tasks.research_pack,
      attempts: activeState.tasks.research_pack.attempts + 1,
      last_attempt_at: now.toISOString(),
      last_status: 'running',
      last_error: null,
    };
    if (!dryRun) await writeState(paths.stateFile, activeState);

    if (!dryRun && config.git_sync.enabled) {
      try {
        const prepared = await prepare(options.repositoryRoot, config);
        if (prepared.recoveredResearchDates?.includes(date)) {
          activeState.tasks.research_pack.last_status = 'success';
          activeState.tasks.research_pack.last_error = null;
          await writeState(paths.stateFile, activeState);
          return result('ALREADY_RESEARCHED', 'success', 0, date, { gitCommit: prepared.commit });
        }
      } catch (error) {
        const gitError = error instanceof GitSyncError
          ? error
          : new GitSyncError(error instanceof Error ? error.message : String(error), 'git_sync_failed');
        activeState.tasks.research_pack.last_status = 'git_sync_failed';
        activeState.tasks.research_pack.last_error = gitError.message;
        await writeState(paths.stateFile, activeState);
        await notifyFailure('git_sync_failed', gitError.message);
        return result('FAILED', 'git_sync_failed', gitError.kind === 'invalid_staged_paths' ? 7 : 6, date, { error: gitError.message });
      }
    }

    const run = await research({
      rootDir: options.repositoryRoot,
      researchDate: date,
      dryRun,
      fixture: options.fixture ?? false,
    });
    let gitResult: GitSyncResult = { status: 'no_changes', commit: null, recoveredCollectionDates: [], recoveredResearchDates: [] };
    if (!dryRun && run.files_written) {
      try {
        gitResult = await sync(options.repositoryRoot, date, config);
      } catch (error) {
        const gitError = error instanceof GitSyncError
          ? error
          : new GitSyncError(error instanceof Error ? error.message : String(error), 'git_sync_failed');
        activeState.tasks.research_pack.last_status = 'git_sync_failed';
        activeState.tasks.research_pack.last_run_id = run.pack.run_id;
        activeState.tasks.research_pack.last_error = gitError.message;
        await writeState(paths.stateFile, activeState);
        await notifyFailure('git_sync_failed', gitError.message);
        return result('FAILED', 'git_sync_failed', gitError.kind === 'invalid_staged_paths' ? 7 : 6, date, {
          runId: run.pack.run_id, error: gitError.message, modelCalls: run.pack.model.calls,
        });
      }
    }
    activeState.tasks.research_pack.last_run_id = run.pack.run_id;
    activeState.tasks.research_pack.last_research_decision = run.pack.decision;
    if (run.pack.status === 'failed') {
      const failure = failureStatus(run);
      activeState.tasks.research_pack.last_status = failure.status;
      activeState.tasks.research_pack.last_error = run.pack.error_message_safe;
      if (!dryRun) await writeState(paths.stateFile, activeState);
      await notifyFailure(failure.status, run.pack.error_message_safe ?? 'Research Pack failed');
      return result('FAILED', failure.status, failure.exitCode, date, {
        runId: run.pack.run_id, error: run.pack.error_message_safe, gitCommit: gitResult.commit, modelCalls: run.pack.model.calls,
      });
    }
    activeState.tasks.research_pack.last_status = 'success';
    activeState.tasks.research_pack.last_error = null;
    if (!dryRun) await writeState(paths.stateFile, activeState);
    if (!dryRun) {
      const title = run.pack.topic?.working_title ?? 'NO_TOPIC';
      await notify('success', `Research ${run.pack.decision}; topic ${title}; experiment ${run.pack.experiment === null ? 'no' : 'yes'}`, config);
    }
    return result(run.execution_status === 'ALREADY_RESEARCHED' ? 'ALREADY_RESEARCHED' : 'COMPLETED', 'success', 0, date, {
      runId: run.pack.run_id,
      gitCommit: gitResult.commit,
      researchDecision: run.pack.decision,
      modelCalls: run.pack.model.calls,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (activeState && !dryRun) {
      activeState.tasks.research_pack.last_status = 'failed';
      activeState.tasks.research_pack.last_error = message;
      try { await writeState(paths.stateFile, activeState); } catch { /* Preserve original error. */ }
    }
    await notifyFailure('failed', message);
    return result('FAILED', 'failed', 1, date, { error: message });
  } finally {
    await lock?.release();
  }
}
