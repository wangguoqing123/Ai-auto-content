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
export type RuntimeTaskName = 'morning' | 'topic_selection';

export interface RuntimeScheduleConfig {
  target_time: string;
  window_start: string;
  window_end: string;
  max_attempts: number;
}

export interface LocalRuntimeConfig {
  version: 1;
  timezone: 'Asia/Shanghai';
  morning: RuntimeScheduleConfig;
  topic_selection: RuntimeScheduleConfig;
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
  last_topic_decision: z.enum(['SELECT_TOPIC', 'NO_PUBLISH']).nullable().optional(),
});

export const schedulerStateSchema = z.object({
  version: z.literal(1),
  timezone: z.literal('Asia/Shanghai'),
  tasks: z.object({
    morning: schedulerTaskStateSchema,
    topic_selection: schedulerTaskStateSchema.optional(),
  }),
}).transform((state) => ({
  ...state,
  tasks: {
    morning: state.tasks.morning,
    topic_selection: state.tasks.topic_selection ?? {
      date: state.tasks.morning.date,
      attempts: 0,
      last_attempt_at: null,
      last_status: 'not_due' as const,
      last_run_id: '',
      last_error: null,
      last_collection_status: null,
      last_topic_decision: null,
    },
  },
}));

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
  task?: RuntimeTaskName;
  topicDecision?: 'SELECT_TOPIC' | 'NO_PUBLISH' | null;
  modelCalls?: number;
}
