import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { runSimpleWritingBuild, type RunSimpleWritingBuildResult } from '../simple-writing/pipeline.js';
import type { SimpleWritingDecision } from '../simple-writing/schemas.js';
import { ensurePrivateOutputDirectory } from '../simple-writing/storage.js';
import { secureAtomicWrite } from '../style-intelligence/safe-local-path.js';
import { loadLocalRuntimeConfig } from './config.js';
import { sendLocalNotification } from './notification.js';
import { createRuntimePaths } from './paths.js';
import { acquireRuntimeLock, type RuntimeLock } from './runtime-lock.js';
import { zonedDateAndMinute, type TriggerMode } from './schedule-window.js';
import type {
  LocalRuntimeConfig,
  RuntimeExecutionResult,
  RuntimePaths,
  RuntimeTaskStatus,
} from './types.js';

const simpleWritingRuntimeStateSchema = z.strictObject({
  date: z.iso.date(),
  status: z.enum([
    'ready_for_human_review',
    'no_content',
    'waiting_for_topic',
    'blocked_no_sources',
    'failed',
  ]),
  model_attempted: z.boolean(),
  model_calls: z.union([z.literal(0), z.literal(1)]),
  output_directory: z.string().nullable(),
  error_code: z.string().max(100).nullable(),
  updated_at: z.iso.datetime(),
});

export type SimpleWritingRuntimeState = z.infer<typeof simpleWritingRuntimeStateSchema>;

export interface SimpleWritingTaskOptions {
  repositoryRoot: string;
  now?: Date;
  dryRun?: boolean;
  fixture?: boolean;
  paths?: RuntimePaths;
  config?: LocalRuntimeConfig;
  triggerMode?: TriggerMode;
  outputRoot?: string;
}

export interface SimpleWritingTaskDependencies {
  readState?: typeof readSimpleWritingRuntimeState;
  writeState?: typeof writeSimpleWritingRuntimeState;
  acquireLock?: typeof acquireRuntimeLock;
  runWriting?: typeof runSimpleWritingBuild;
  notify?: typeof sendLocalNotification;
}

function stateFile(paths: RuntimePaths): string {
  return path.join(paths.stateDirectory, 'simple-writing-state.json');
}

export async function readSimpleWritingRuntimeState(filePath: string): Promise<SimpleWritingRuntimeState | null> {
  try {
    return simpleWritingRuntimeStateSchema.parse(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Simple Writing runtime state is corrupt and was not overwritten.', { cause: error });
  }
}

export async function writeSimpleWritingRuntimeState(
  filePath: string,
  state: SimpleWritingRuntimeState,
  repositoryRoot: string,
): Promise<void> {
  const validated = simpleWritingRuntimeStateSchema.parse(state);
  await ensurePrivateOutputDirectory(path.dirname(filePath), repositoryRoot);
  await secureAtomicWrite(filePath, `${JSON.stringify(validated, null, 2)}\n`);
}

function minutes(value: string): number {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function completed(state: SimpleWritingRuntimeState | null, date: string): boolean {
  if (state?.date !== date) return false;
  return state.model_attempted || state.status === 'ready_for_human_review' || state.status === 'no_content';
}

function result(
  outcome: RuntimeExecutionResult['outcome'],
  status: RuntimeTaskStatus,
  exitCode: number,
  date: string,
  options: {
    decision?: SimpleWritingDecision | null;
    modelCalls?: number;
    outputDirectory?: string | null;
    error?: string | null;
    runId?: string | null;
  } = {},
): RuntimeExecutionResult {
  return {
    outcome,
    status,
    exitCode,
    date,
    runId: options.runId ?? null,
    error: options.error ?? null,
    collected: false,
    gitCommit: null,
    task: 'simple_writing',
    writingDecision: options.decision ?? null,
    modelCalls: options.modelCalls ?? 0,
    outputDirectory: options.outputDirectory ?? null,
  };
}

function stateStatus(run: RunSimpleWritingBuildResult): SimpleWritingRuntimeState['status'] {
  if (run.pack.decision === 'READY_FOR_HUMAN_REVIEW') return 'ready_for_human_review';
  if (run.pack.decision === 'NO_CONTENT') return 'no_content';
  if (run.pack.decision === 'WAITING_FOR_TOPIC') return 'waiting_for_topic';
  if (run.pack.decision === 'BLOCKED_NO_SOURCES') return 'blocked_no_sources';
  return 'failed';
}

function executionFor(run: RunSimpleWritingBuildResult): RuntimeExecutionResult {
  const common = {
    decision: run.pack.decision,
    modelCalls: run.pack.model.calls,
    outputDirectory: run.output_directory,
    runId: run.pack.run_id,
  };
  if (run.pack.decision === 'WAITING_FOR_TOPIC') {
    return result('WAITING_FOR_TOPIC', 'waiting_for_topic', 0, run.pack.writing_date, common);
  }
  if (run.pack.decision === 'BLOCKED_NO_SOURCES') {
    return result('BLOCKED_NO_SOURCES', 'blocked', 0, run.pack.writing_date, common);
  }
  if (run.pack.status === 'failed') {
    const unavailable = /^codex_/.test(run.pack.error_code ?? '');
    return result('FAILED', unavailable ? 'unavailable' : 'failed', unavailable ? 3 : 4, run.pack.writing_date, {
      ...common,
      error: run.pack.error_code,
    });
  }
  return result('COMPLETED', 'success', 0, run.pack.writing_date, common);
}

export async function runSimpleWritingTask(
  options: SimpleWritingTaskOptions,
  dependencies: SimpleWritingTaskDependencies = {},
): Promise<RuntimeExecutionResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const fixture = options.fixture ?? false;
  const paths = options.paths ?? createRuntimePaths();
  const config = options.config ?? await loadLocalRuntimeConfig(options.repositoryRoot, paths.configFile);
  const triggerMode = options.triggerMode ?? 'scheduled';
  const current = zonedDateAndMinute(now, config.timezone);
  const schedule = config.simple_writing;
  if (triggerMode === 'scheduled' && !schedule.enabled) {
    return result('DISABLED', 'not_due', 0, current.date);
  }
  if (triggerMode === 'scheduled'
    && (current.minute < minutes(schedule.window_start) || current.minute > minutes(schedule.window_end))) {
    return result('NOT_DUE', 'not_due', 0, current.date);
  }

  const readState = dependencies.readState ?? readSimpleWritingRuntimeState;
  const writeState = dependencies.writeState ?? writeSimpleWritingRuntimeState;
  const lockFactory = dependencies.acquireLock ?? acquireRuntimeLock;
  const write = dependencies.runWriting ?? runSimpleWritingBuild;
  const notify = dependencies.notify ?? sendLocalNotification;
  const persistState = !dryRun || fixture;
  let lock: RuntimeLock | null = null;

  try {
    const initial = persistState ? await readState(stateFile(paths)) : null;
    if (completed(initial, current.date)) {
      return result('ALREADY_COMPLETED', initial?.status === 'ready_for_human_review' || initial?.status === 'no_content' ? 'success' : 'failed', 0, current.date, {
        modelCalls: initial?.model_calls ?? 0,
        outputDirectory: initial?.output_directory ?? null,
        error: initial?.error_code ?? null,
      });
    }

    lock = await lockFactory(paths.lockDirectory, 'simple_writing', now, config.runtime.lock_stale_minutes);
    if (!lock.acquired) return result('LOCK_HELD', 'running', 0, current.date);
    const latest = persistState ? await readState(stateFile(paths)) : null;
    if (completed(latest, current.date)) {
      return result('ALREADY_COMPLETED', latest?.status === 'ready_for_human_review' || latest?.status === 'no_content' ? 'success' : 'failed', 0, current.date, {
        modelCalls: latest?.model_calls ?? 0,
        outputDirectory: latest?.output_directory ?? null,
        error: latest?.error_code ?? null,
      });
    }

    const markProviderAttempt = async (): Promise<void> => {
      if (!persistState) return;
      await writeState(stateFile(paths), {
        date: current.date,
        status: 'failed',
        model_attempted: true,
        model_calls: 1,
        output_directory: null,
        error_code: 'writer_attempt_started',
        updated_at: now.toISOString(),
      }, options.repositoryRoot);
    };
    const run = await write({
      rootDir: options.repositoryRoot,
      writingDate: current.date,
      dryRun,
      fixture,
      ...(options.outputRoot === undefined ? {} : { outputRoot: options.outputRoot }),
      now,
    }, { beforeProviderCall: markProviderAttempt });
    const runtimeState: SimpleWritingRuntimeState = {
      date: current.date,
      status: stateStatus(run),
      model_attempted: run.pack.model.calls === 1,
      model_calls: run.pack.model.calls,
      output_directory: run.output_directory,
      error_code: run.pack.error_code,
      updated_at: now.toISOString(),
    };
    if (persistState) await writeState(stateFile(paths), runtimeState, options.repositoryRoot);

    if (!dryRun && run.pack.decision === 'READY_FOR_HUMAN_REVIEW') {
      await notify('success', '今日文章草稿已生成，请人工检查。', config);
    } else if (!dryRun && run.pack.status === 'failed') {
      await notify('failed', `Simple Writing failed: ${run.pack.error_code ?? 'unknown_error'}`, config);
    }
    return executionFor(run);
  } catch {
    if (!dryRun) await notify('failed', 'Simple Writing failed: runtime_error', config);
    return result('FAILED', 'failed', 1, current.date, { error: 'runtime_error' });
  } finally {
    await lock?.release();
  }
}
