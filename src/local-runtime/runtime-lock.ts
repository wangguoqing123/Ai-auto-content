import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

interface LockMetadata {
  pid: number;
  started_at: string;
  task: string;
  hostname: string;
}

export interface RuntimeLock {
  acquired: boolean;
  staleRecovered: boolean;
  metadata: LockMetadata;
  release(): Promise<void>;
}

export interface LockDependencies {
  pid?: number;
  hostname?: string;
  processAlive?: (pid: number) => boolean;
}

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

async function readMetadata(lockDirectory: string): Promise<LockMetadata | null> {
  try {
    const value = JSON.parse(await readFile(path.join(lockDirectory, 'lock.json'), 'utf8')) as Partial<LockMetadata>;
    if (typeof value.pid !== 'number' || typeof value.started_at !== 'string'
      || typeof value.task !== 'string' || typeof value.hostname !== 'string') return null;
    return value as LockMetadata;
  } catch {
    return null;
  }
}

export async function acquireRuntimeLock(
  lockDirectory: string,
  task: string,
  now: Date,
  staleMinutes: number,
  dependencies: LockDependencies = {},
): Promise<RuntimeLock> {
  const metadata: LockMetadata = {
    pid: dependencies.pid ?? process.pid,
    started_at: now.toISOString(),
    task,
    hostname: dependencies.hostname ?? os.hostname(),
  };
  const processAlive = dependencies.processAlive ?? defaultProcessAlive;
  let staleRecovered = false;

  await mkdir(path.dirname(lockDirectory), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDirectory);
      try {
        await writeFile(path.join(lockDirectory, 'lock.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      } catch (error) {
        await rm(lockDirectory, { recursive: true, force: true });
        throw error;
      }
      let released = false;
      return {
        acquired: true,
        staleRecovered,
        metadata,
        release: async () => {
          if (released) return;
          released = true;
          await rm(lockDirectory, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      const existing = await readMetadata(lockDirectory);
      const ageMs = existing ? now.getTime() - Date.parse(existing.started_at) : Number.POSITIVE_INFINITY;
      const alive = existing ? processAlive(existing.pid) : false;
      if (alive || ageMs <= staleMinutes * 60_000) {
        return { acquired: false, staleRecovered: false, metadata: existing ?? metadata, release: async () => undefined };
      }
      const quarantine = `${lockDirectory}.stale-${process.pid}-${Date.now()}`;
      try {
        await rename(lockDirectory, quarantine);
        await rm(quarantine, { recursive: true, force: true });
        staleRecovered = true;
      } catch (renameError) {
        if (renameError instanceof Error && 'code' in renameError && renameError.code === 'ENOENT') continue;
        throw renameError;
      }
    }
  }
  return { acquired: false, staleRecovered, metadata, release: async () => undefined };
}
