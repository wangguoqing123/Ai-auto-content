import { runTopicSelection, type RunTopicSelectionResult } from '../topic-intelligence/pipeline.js';
import { readExistingTopicDecision } from '../topic-intelligence/storage.js';
import { loadLocalRuntimeConfig } from './config.js';
import { commitAndPushTopicData, GitSyncError, prepareRuntimeRepository, type GitSyncResult } from './git-sync.js';
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

export interface TopicSelectionTaskOptions {
  repositoryRoot: string;
  now?: Date;
  dryRun?: boolean;
  fixture?: boolean;
  paths?: RuntimePaths;
  config?: LocalRuntimeConfig;
  triggerMode?: TriggerMode;
}

export interface TopicSelectionTaskDependencies {
  readState?: typeof readSchedulerState;
  writeState?: typeof writeSchedulerState;
  acquireLock?: typeof acquireRuntimeLock;
  runSelection?: typeof runTopicSelection;
  prepareRepository?: (root: string, config: LocalRuntimeConfig) => Promise<GitSyncResult>;
  syncData?: (root: string, date: string, config: LocalRuntimeConfig) => Promise<GitSyncResult>;
  notify?: typeof sendLocalNotification;
}

function result(
  outcome: RuntimeExecutionResult['outcome'],
  status: RuntimeTaskStatus,
  exitCode: number,
  date: string,
  options: Partial<Pick<RuntimeExecutionResult, 'runId' | 'error' | 'gitCommit' | 'topicDecision' | 'modelCalls'>> = {},
): RuntimeExecutionResult {
  return {
    outcome,
    status,
    exitCode,
    date,
    runId: options.runId ?? null,
    error: options.error ?? null,
    collected: false,
    gitCommit: options.gitCommit ?? null,
    task: 'topic_selection',
    topicDecision: options.topicDecision ?? null,
    modelCalls: options.modelCalls ?? 0,
  };
}

function stateForDate(existing: SchedulerState | null, date: string): SchedulerState {
  if (existing === null) return createEmptyState(date);
  if (existing.tasks.topic_selection.date === date) return existing;
  return {
    ...existing,
    tasks: {
      ...existing.tasks,
      topic_selection: createEmptyState(date).tasks.topic_selection,
    },
  };
}

function failureStatus(selection: RunTopicSelectionResult): { status: RuntimeTaskStatus; exitCode: number } {
  if (selection.decision.error_code === 'model_unavailable' || selection.decision.error_code === 'model_timeout') {
    return { status: 'unavailable', exitCode: 3 };
  }
  if (selection.decision.error_code === 'model_output_invalid') return { status: 'failed', exitCode: 2 };
  return { status: 'failed', exitCode: 4 };
}

export async function runTopicSelectionTask(
  options: TopicSelectionTaskOptions,
  dependencies: TopicSelectionTaskDependencies = {},
): Promise<RuntimeExecutionResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const paths = options.paths ?? createRuntimePaths();
  const config = options.config ?? await loadLocalRuntimeConfig(options.repositoryRoot, paths.configFile);
  const readState = dependencies.readState ?? readSchedulerState;
  const writeState = dependencies.writeState ?? writeSchedulerState;
  const lockFactory = dependencies.acquireLock ?? acquireRuntimeLock;
  const select = dependencies.runSelection ?? runTopicSelection;
  const prepare = dependencies.prepareRepository ?? prepareRuntimeRepository;
  const sync = dependencies.syncData ?? commitAndPushTopicData;
  const notify = dependencies.notify ?? sendLocalNotification;
  const triggerMode = options.triggerMode ?? 'scheduled';
  let lock: RuntimeLock | null = null;
  let activeState: SchedulerState | null = null;
  let date = scheduleDecision(now, config, null, triggerMode, 'topic_selection').date;

  const notifyFailure = async (status: RuntimeTaskStatus, message: string): Promise<void> => {
    if (dryRun) return;
    const reachedMaximum = (activeState?.tasks.topic_selection.attempts ?? 0) >= config.topic_selection.max_attempts;
    await notify(
      reachedMaximum ? 'failed' : status,
      reachedMaximum ? `Topic selection reached ${config.topic_selection.max_attempts} attempts` : message,
      config,
    );
  };

  try {
    const initialState = dryRun ? null : await readState(paths.stateFile);
    const initialDecision = scheduleDecision(now, config, initialState?.tasks.topic_selection ?? null, triggerMode, 'topic_selection');
    date = initialDecision.date;
    if (initialDecision.decision === 'NOT_DUE') return result('NOT_DUE', 'not_due', 0, date);
    if (initialDecision.decision === 'ALREADY_COMPLETED') {
      return result('ALREADY_COMPLETED', 'success', 0, date, {
        runId: initialState?.tasks.topic_selection.last_run_id || null,
        topicDecision: initialState?.tasks.topic_selection.last_topic_decision ?? null,
      });
    }
    if (initialDecision.decision === 'MAX_ATTEMPTS_REACHED') {
      return result('MAX_ATTEMPTS_REACHED', initialState?.tasks.topic_selection.last_status ?? 'failed', 0, date);
    }

    lock = await lockFactory(paths.lockDirectory, 'topic_selection', now, config.runtime.lock_stale_minutes);
    if (!lock.acquired) return result('LOCK_HELD', 'running', 0, date);

    const latestState = dryRun ? null : await readState(paths.stateFile);
    const lockedDecision = scheduleDecision(now, config, latestState?.tasks.topic_selection ?? null, triggerMode, 'topic_selection');
    if (lockedDecision.decision !== 'DUE') {
      const status = lockedDecision.decision === 'ALREADY_COMPLETED'
        ? 'success'
        : lockedDecision.decision === 'MAX_ATTEMPTS_REACHED'
          ? (latestState?.tasks.topic_selection.last_status ?? 'failed')
          : 'not_due';
      return result(lockedDecision.decision, status, 0, date);
    }

    activeState = stateForDate(latestState, date);
    activeState.tasks.topic_selection = {
      ...activeState.tasks.topic_selection,
      attempts: activeState.tasks.topic_selection.attempts + 1,
      last_attempt_at: now.toISOString(),
      last_status: 'running',
      last_error: null,
    };
    if (!dryRun) await writeState(paths.stateFile, activeState);

    if (!dryRun && config.git_sync.enabled) {
      try {
        const prepared = await prepare(options.repositoryRoot, config);
        if (prepared.recoveredTopicDecisionDates?.includes(date)) {
          const existing = await readExistingTopicDecision(options.repositoryRoot, date);
          if (existing.state === 'valid' && existing.decision.status === 'success') {
            activeState.tasks.topic_selection.last_status = 'success';
            activeState.tasks.topic_selection.last_run_id = existing.decision.run_id;
            activeState.tasks.topic_selection.last_topic_decision = existing.decision.decision;
            await writeState(paths.stateFile, activeState);
            return result('COMPLETED', 'success', 0, date, {
              runId: existing.decision.run_id,
              gitCommit: prepared.commit,
              topicDecision: existing.decision.decision,
              modelCalls: existing.decision.model.calls,
            });
          }
        }
      } catch (error) {
        const gitError = error instanceof GitSyncError
          ? error
          : new GitSyncError(error instanceof Error ? error.message : String(error), 'git_sync_failed');
        activeState.tasks.topic_selection.last_status = 'git_sync_failed';
        activeState.tasks.topic_selection.last_error = gitError.message;
        await writeState(paths.stateFile, activeState);
        await notifyFailure('git_sync_failed', gitError.message);
        return result('FAILED', 'git_sync_failed', gitError.kind === 'invalid_staged_paths' ? 7 : 6, date, { error: gitError.message });
      }
    }

    const selection = await select({
      rootDir: options.repositoryRoot,
      decisionDate: date,
      dryRun,
      fixture: options.fixture ?? false,
    });

    let gitResult: GitSyncResult = { status: 'no_changes', commit: null, recoveredCollectionDates: [], recoveredTopicDecisionDates: [] };
    if (!dryRun && selection.files_written) {
      try {
        gitResult = await sync(options.repositoryRoot, date, config);
      } catch (error) {
        const gitError = error instanceof GitSyncError
          ? error
          : new GitSyncError(error instanceof Error ? error.message : String(error), 'git_sync_failed');
        activeState.tasks.topic_selection.last_status = 'git_sync_failed';
        activeState.tasks.topic_selection.last_run_id = selection.decision.run_id;
        activeState.tasks.topic_selection.last_error = gitError.message;
        await writeState(paths.stateFile, activeState);
        await notifyFailure('git_sync_failed', gitError.message);
        return result('FAILED', 'git_sync_failed', gitError.kind === 'invalid_staged_paths' ? 7 : 6, date, {
          runId: selection.decision.run_id,
          error: gitError.message,
          modelCalls: selection.decision.model.calls,
        });
      }
    }

    activeState.tasks.topic_selection.last_run_id = selection.decision.run_id;
    activeState.tasks.topic_selection.last_topic_decision = selection.decision.decision;
    if (selection.decision.status === 'failed') {
      const failure = failureStatus(selection);
      activeState.tasks.topic_selection.last_status = failure.status;
      activeState.tasks.topic_selection.last_error = selection.decision.error_message_safe;
      if (!dryRun) await writeState(paths.stateFile, activeState);
      await notifyFailure(failure.status, selection.decision.error_message_safe ?? 'Topic selection failed');
      return result('FAILED', failure.status, failure.exitCode, date, {
        runId: selection.decision.run_id,
        error: selection.decision.error_message_safe,
        gitCommit: gitResult.commit,
        modelCalls: selection.decision.model.calls,
      });
    }

    activeState.tasks.topic_selection.last_status = 'success';
    activeState.tasks.topic_selection.last_error = null;
    if (!dryRun) await writeState(paths.stateFile, activeState);
    if (!dryRun) await notify('success', `Topic selection completed: ${selection.decision.decision}`, config);
    return result(selection.execution_status === 'ALREADY_DECIDED' ? 'ALREADY_COMPLETED' : 'COMPLETED', 'success', 0, date, {
      runId: selection.decision.run_id,
      gitCommit: gitResult.commit,
      topicDecision: selection.decision.decision,
      modelCalls: selection.decision.model.calls,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (activeState && !dryRun) {
      activeState.tasks.topic_selection.last_status = 'failed';
      activeState.tasks.topic_selection.last_error = message;
      try { await writeState(paths.stateFile, activeState); } catch { /* Preserve the original failure. */ }
    }
    await notifyFailure('failed', message);
    return result('FAILED', 'failed', 1, date, { error: message });
  } finally {
    await lock?.release();
  }
}
