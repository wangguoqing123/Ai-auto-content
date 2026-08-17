import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { schedulerStateSchema, type SchedulerState } from './types.js';

export class CorruptSchedulerStateError extends Error {
  constructor(filePath: string, cause: unknown) {
    super(`Scheduler state is corrupt and was not overwritten: ${filePath}`, { cause });
    this.name = 'CorruptSchedulerStateError';
  }
}

export function createEmptyState(date: string): SchedulerState {
  const emptyTask = () => ({
    date,
    attempts: 0,
    last_attempt_at: null,
    last_status: 'not_due' as const,
    last_run_id: '',
    last_error: null,
    last_collection_status: null,
    last_topic_decision: null,
    last_research_decision: null,
  });
  return {
    version: 1,
    timezone: 'Asia/Shanghai',
    tasks: {
      morning: emptyTask(),
      topic_selection: emptyTask(),
      research_pack: emptyTask(),
      writing_pack: emptyTask(),
    },
  };
}

export async function readSchedulerState(filePath: string): Promise<SchedulerState | null> {
  try {
    return schedulerStateSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw new CorruptSchedulerStateError(filePath, error);
  }
}

export async function writeSchedulerState(filePath: string, state: SchedulerState): Promise<void> {
  const validated = schedulerStateSchema.parse(state);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, filePath);
}
