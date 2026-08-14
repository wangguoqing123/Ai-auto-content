import { beforeAll, describe, expect, it } from 'vitest';
import { loadLocalRuntimeConfig } from '../src/local-runtime/config.js';
import { scheduleDecision, zonedDateAndMinute } from '../src/local-runtime/schedule-window.js';
import type { LocalRuntimeConfig, SchedulerTaskState } from '../src/local-runtime/types.js';

let config: LocalRuntimeConfig;

beforeAll(async () => { config = await loadLocalRuntimeConfig(process.cwd()); });

function state(overrides: Partial<SchedulerTaskState> = {}): SchedulerTaskState {
  return {
    date: '2026-08-14', attempts: 0, last_attempt_at: null, last_status: 'not_due',
    last_run_id: '', last_error: null, last_collection_status: null, ...overrides,
  };
}

describe('local morning schedule window', () => {
  it.each([
    ['2026-08-13T23:29:00.000Z', 'NOT_DUE'],
    ['2026-08-13T23:30:00.000Z', 'DUE'],
    ['2026-08-14T00:00:00.000Z', 'DUE'],
    ['2026-08-14T04:00:00.000Z', 'DUE'],
    ['2026-08-14T04:00:59.000Z', 'DUE'],
    ['2026-08-14T04:01:00.000Z', 'NOT_DUE'],
  ])('decides %s as %s in Asia/Shanghai', (timestamp, expected) => {
    expect(scheduleDecision(new Date(timestamp), config, null).decision).toBe(expected);
  });

  it('does not repeat a successful day', () => {
    expect(scheduleDecision(new Date('2026-08-14T00:00:00Z'), config, state({ last_status: 'success' })).decision).toBe('ALREADY_COMPLETED');
  });

  it('does not repeat a partial-success day', () => {
    expect(scheduleDecision(new Date('2026-08-14T00:00:00Z'), config, state({ last_status: 'partial_success' })).decision).toBe('ALREADY_COMPLETED');
  });

  it('allows a failed attempt below the maximum', () => {
    expect(scheduleDecision(new Date('2026-08-14T00:00:00Z'), config, state({ attempts: 1, last_status: 'failed' })).decision).toBe('DUE');
  });

  it('stops after the configured maximum attempts', () => {
    expect(scheduleDecision(new Date('2026-08-14T00:00:00Z'), config, state({ attempts: 2, last_status: 'failed' })).decision).toBe('MAX_ATTEMPTS_REACHED');
  });

  it('returns not due outside the scheduled window before checking maximum attempts', () => {
    expect(scheduleDecision(
      new Date('2026-08-14T04:01:00Z'),
      config,
      state({ attempts: 2, last_status: 'failed' }),
      'scheduled',
    ).decision).toBe('NOT_DUE');
  });

  it('allows a manual run outside the scheduled window while retaining completion and attempt guards', () => {
    const afternoon = new Date('2026-08-14T06:00:00Z');
    expect(scheduleDecision(afternoon, config, null, 'manual').decision).toBe('DUE');
    expect(scheduleDecision(afternoon, config, state({ last_status: 'success' }), 'manual').decision).toBe('ALREADY_COMPLETED');
    expect(scheduleDecision(afternoon, config, state({ attempts: 2, last_status: 'failed' }), 'manual').decision).toBe('MAX_ATTEMPTS_REACHED');
  });

  it('uses Shanghai time independently from the process timezone', () => {
    expect(zonedDateAndMinute(new Date('2026-08-13T16:15:00Z'))).toEqual({ date: '2026-08-14', minute: 15 });
  });
});

describe('local topic selection schedule window', () => {
  it.each([
    ['2026-08-14T04:59:00.000Z', 'NOT_DUE'],
    ['2026-08-14T05:00:00.000Z', 'DUE'],
    ['2026-08-14T10:00:59.000Z', 'DUE'],
    ['2026-08-14T10:01:00.000Z', 'NOT_DUE'],
  ])('decides %s as %s', (timestamp, expected) => {
    expect(scheduleDecision(new Date(timestamp), config, null, 'scheduled', 'topic_selection').decision).toBe(expected);
  });

  it('treats a completed topic decision as already completed', () => {
    expect(scheduleDecision(
      new Date('2026-08-14T05:00:00.000Z'),
      config,
      state({ last_status: 'success', last_topic_decision: 'NO_PUBLISH' }),
      'scheduled',
      'topic_selection',
    ).decision).toBe('ALREADY_COMPLETED');
  });
});
