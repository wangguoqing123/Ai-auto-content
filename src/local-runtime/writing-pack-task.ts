import { runWritingBuild, type RunWritingBuildOptions } from '../writing/pipeline.js';
import { loadLocalRuntimeConfig } from './config.js';
import { scheduleDecision, type TriggerMode } from './schedule-window.js';
import type { LocalRuntimeConfig, RuntimeExecutionResult, RuntimePaths, RuntimeTaskStatus } from './types.js';

export interface WritingPackTaskOptions {
  repositoryRoot: string;
  now?: Date;
  dryRun?: boolean;
  fixture?: boolean;
  paths?: RuntimePaths;
  config?: LocalRuntimeConfig;
  triggerMode?: TriggerMode;
}

export interface WritingPackTaskDependencies { runWriting?: (options: RunWritingBuildOptions) => ReturnType<typeof runWritingBuild> }

function result(status: RuntimeTaskStatus, date: string, decision: NonNullable<RuntimeExecutionResult['writingDecision']> | null, modelCalls = 0): RuntimeExecutionResult {
  return {
    outcome: status === 'not_due' ? 'NOT_DUE' : status === 'failed' ? 'FAILED' : 'COMPLETED',
    status, exitCode: status === 'failed' ? 1 : 0, date, runId: null, error: null, collected: false, gitCommit: null,
    task: 'writing_pack', modelCalls, writingDecision: decision,
  };
}

export async function runWritingPackTask(options: WritingPackTaskOptions, dependencies: WritingPackTaskDependencies = {}): Promise<RuntimeExecutionResult> {
  const now = options.now ?? new Date();
  const config = options.config ?? await loadLocalRuntimeConfig(options.repositoryRoot, options.paths?.configFile);
  const scheduled = scheduleDecision(now, config, null, options.triggerMode ?? 'scheduled', 'writing_pack');
  if (scheduled.decision === 'NOT_DUE') return result('not_due', scheduled.date, null);
  try {
    // Scheduler deliberately supplies no Provisional paths or allow flag. A READY Research Pack therefore waits for a future approved Profile.
    const run = await (dependencies.runWriting ?? runWritingBuild)({
      rootDir: options.repositoryRoot, writingDate: scheduled.date, dryRun: options.dryRun ?? false,
      fixture: options.fixture ?? false, writeOutputs: false,
    });
    const decision = run.pack.decision;
    const status: RuntimeTaskStatus = decision === 'WAITING_FOR_APPROVED_STYLE' ? 'waiting_for_approved_style'
      : decision === 'WAITING_FOR_RESEARCH' ? 'waiting_for_research'
        : decision === 'BLOCKED_BY_RESEARCH' ? 'blocked_by_research'
          : decision === 'READY_FOR_HUMAN_REVIEW' ? 'ready_for_human_review'
            : run.pack.status === 'failed' ? 'failed' : 'success';
    return result(status, scheduled.date, decision, run.pack.model.calls);
  } catch { return result('failed', scheduled.date, null); }
}
