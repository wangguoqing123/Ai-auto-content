import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CorruptSchedulerStateError, createEmptyState, readSchedulerState, writeSchedulerState } from '../src/local-runtime/runtime-state.js';

const roots: string[] = [];

async function stateFile(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-state-test-'));
  roots.push(root);
  return path.join(root, 'nested', 'scheduler-state.json');
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('scheduler state persistence', () => {
  it('returns null when state has never been written', async () => {
    expect(await readSchedulerState(await stateFile())).toBeNull();
  });

  it('writes and reads a validated state atomically', async () => {
    const file = await stateFile();
    const state = createEmptyState('2026-08-14');
    state.tasks.morning.attempts = 1;
    await writeSchedulerState(file, state);
    expect(await readSchedulerState(file)).toEqual(state);
    expect((await readFile(file, 'utf8')).endsWith('\n')).toBe(true);
  });

  it('does not silently replace corrupt JSON', async () => {
    const file = await stateFile();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{broken');
    await expect(readSchedulerState(file)).rejects.toBeInstanceOf(CorruptSchedulerStateError);
    expect(await readFile(file, 'utf8')).toBe('{broken');
  });

  it('rejects invalid status values before writing', async () => {
    const file = await stateFile();
    const state = createEmptyState('2026-08-14') as unknown as { tasks: { morning: { last_status: string } } };
    state.tasks.morning.last_status = 'invented';
    await expect(writeSchedulerState(file, state as never)).rejects.toThrow();
  });
});
