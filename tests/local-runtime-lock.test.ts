import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireRuntimeLock } from '../src/local-runtime/runtime-lock.js';

const temporaryDirectories: string[] = [];

async function lockPath(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-lock-test-'));
  temporaryDirectories.push(root);
  return path.join(root, 'morning.lock');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('runtime lock', () => {
  it('blocks a second process while the recorded PID is alive', async () => {
    const target = await lockPath();
    const first = await acquireRuntimeLock(target, 'morning', new Date('2026-08-14T00:00:00Z'), 120, { pid: 100, processAlive: () => true });
    const second = await acquireRuntimeLock(target, 'morning', new Date('2026-08-14T00:01:00Z'), 120, { pid: 200, processAlive: () => true });
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    await first.release();
  });

  it('recovers an expired lock whose PID is no longer alive', async () => {
    const target = await lockPath();
    await mkdir(target);
    await writeFile(path.join(target, 'lock.json'), JSON.stringify({ pid: 100, started_at: '2026-08-13T20:00:00Z', task: 'morning', hostname: 'old' }));
    const lock = await acquireRuntimeLock(target, 'morning', new Date('2026-08-14T00:00:00Z'), 120, { pid: 200, processAlive: () => false });
    expect(lock).toMatchObject({ acquired: true, staleRecovered: true });
    expect(JSON.parse(await readFile(path.join(target, 'lock.json'), 'utf8'))).toMatchObject({ pid: 200, task: 'morning' });
    await lock.release();
  });

  it('does not remove a recent lock merely because its PID cannot be found', async () => {
    const target = await lockPath();
    await mkdir(target);
    await writeFile(path.join(target, 'lock.json'), JSON.stringify({ pid: 100, started_at: '2026-08-13T23:30:00Z', task: 'morning', hostname: 'old' }));
    const lock = await acquireRuntimeLock(target, 'morning', new Date('2026-08-14T00:00:00Z'), 120, { processAlive: () => false });
    expect(lock.acquired).toBe(false);
  });

  it('release is idempotent', async () => {
    const target = await lockPath();
    const lock = await acquireRuntimeLock(target, 'morning', new Date('2026-08-14T00:00:00Z'), 120);
    await lock.release();
    await expect(lock.release()).resolves.toBeUndefined();
  });
});
