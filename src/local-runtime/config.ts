import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { LocalRuntimeConfig } from './types.js';

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

const schedule = z.object({
  target_time: time,
  window_start: time,
  window_end: time,
  max_attempts: z.number().int().min(1).max(2),
});

const simpleWritingSchedule = schedule.omit({ max_attempts: true });

const localRuntimeConfigSchema = z.object({
  version: z.literal(1),
  timezone: z.literal('Asia/Shanghai'),
  morning: schedule,
  topic_selection: schedule.default({
    target_time: '13:00',
    window_start: '13:00',
    window_end: '18:00',
    max_attempts: 2,
  }),
  research_pack: schedule.default({
    target_time: '13:30',
    window_start: '13:30',
    window_end: '21:00',
    max_attempts: 2,
  }),
  simple_writing: simpleWritingSchedule.default({
    target_time: '14:30',
    window_start: '14:30',
    window_end: '22:00',
  }),
  scheduler: z.object({
    check_interval_seconds: z.number().int().min(60),
  }),
  runtime: z.object({
    auto_launch_chrome: z.boolean(),
    chrome_startup_wait_seconds: z.number().int().min(0).max(60),
    lock_stale_minutes: z.number().int().min(1),
  }),
  git_sync: z.object({
    enabled: z.boolean(),
    branch: z.literal('main'),
    remote: z.string().min(1),
  }),
  notification: z.object({
    enabled: z.boolean(),
    notify_on_success: z.boolean(),
    notify_on_partial_success: z.boolean(),
    notify_on_failure: z.boolean(),
  }),
});

export async function loadLocalRuntimeConfig(
  repositoryRoot: string,
  externalConfigFile?: string,
): Promise<LocalRuntimeConfig> {
  const candidates = externalConfigFile
    ? [externalConfigFile, path.join(repositoryRoot, 'config', 'local-runtime.yaml')]
    : [path.join(repositoryRoot, 'config', 'local-runtime.yaml')];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return localRuntimeConfigSchema.parse(parse(await readFile(candidate, 'utf8'))) as LocalRuntimeConfig;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Local runtime config not found');
}
