import { z } from 'zod';

export const runtimeTaskStatuses = [
  'not_due',
  'running',
  'success',
  'partial_success',
  'failed',
  'login_required',
  'blocked',
  'unavailable',
  'git_sync_failed',
] as const;

export type RuntimeTaskStatus = typeof runtimeTaskStatuses[number];
export type CompletedCollectionStatus = 'success' | 'partial_success';

export interface LocalRuntimeConfig {
  version: 1;
  timezone: 'Asia/Shanghai';
  morning: {
    target_time: string;
    window_start: string;
    window_end: string;
    max_attempts: number;
  };
  scheduler: { check_interval_seconds: number };
  runtime: {
    auto_launch_chrome: boolean;
    chrome_startup_wait_seconds: number;
    lock_stale_minutes: number;
  };
  git_sync: {
    enabled: boolean;
    branch: 'main';
    remote: string;
  };
  notification: {
    enabled: boolean;
    notify_on_success: boolean;
    notify_on_partial_success: boolean;
    notify_on_failure: boolean;
  };
}

export const schedulerTaskStateSchema = z.object({
  date: z.iso.date(),
  attempts: z.number().int().nonnegative(),
  last_attempt_at: z.iso.datetime().nullable(),
  last_status: z.enum(runtimeTaskStatuses),
  last_run_id: z.string(),
  last_error: z.string().nullable(),
  last_collection_status: z.enum(['success', 'partial_success']).nullable().default(null),
});

export const schedulerStateSchema = z.object({
  version: z.literal(1),
  timezone: z.literal('Asia/Shanghai'),
  tasks: z.object({
    morning: schedulerTaskStateSchema,
  }),
});

export type SchedulerTaskState = z.infer<typeof schedulerTaskStateSchema>;
export type SchedulerState = z.infer<typeof schedulerStateSchema>;

export interface RuntimePaths {
  supportRoot: string;
  runtimeRoot: string;
  stateDirectory: string;
  stateFile: string;
  lockDirectory: string;
  configDirectory: string;
  configFile: string;
  logsDirectory: string;
  launchAgentsDirectory: string;
  launchAgentFile: string;
}

export interface RuntimeExecutionResult {
  outcome: 'NOT_DUE' | 'ALREADY_COMPLETED' | 'MAX_ATTEMPTS_REACHED' | 'LOCK_HELD' | 'COMPLETED' | 'FAILED';
  status: RuntimeTaskStatus;
  exitCode: number;
  date: string;
  runId: string | null;
  error: string | null;
  collected: boolean;
  gitCommit: string | null;
}
