import type { LocalRuntimeConfig, SchedulerTaskState } from './types.js';

export type ScheduleDecision = 'DUE' | 'NOT_DUE' | 'ALREADY_COMPLETED' | 'MAX_ATTEMPTS_REACHED';

function timeToMinutes(value: string): number {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function zonedDateAndMinute(now: Date, timeZone = 'Asia/Shanghai'): { date: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function scheduleDecision(
  now: Date,
  config: LocalRuntimeConfig,
  state: SchedulerTaskState | null,
): { decision: ScheduleDecision; date: string } {
  const current = zonedDateAndMinute(now, config.timezone);
  const today = state?.date === current.date ? state : null;
  if (today?.last_status === 'success' || today?.last_status === 'partial_success') {
    return { decision: 'ALREADY_COMPLETED', date: current.date };
  }
  if ((today?.attempts ?? 0) >= config.morning.max_attempts) {
    return { decision: 'MAX_ATTEMPTS_REACHED', date: current.date };
  }
  const start = timeToMinutes(config.morning.window_start);
  const end = timeToMinutes(config.morning.window_end);
  if (current.minute < start || current.minute > end) return { decision: 'NOT_DUE', date: current.date };
  return { decision: 'DUE', date: current.date };
}
