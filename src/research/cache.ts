import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CleanedSourceSnapshot } from './schemas.js';

export function defaultResearchCacheRoot(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, 'Library', 'Application Support', 'AiAutoContent', 'research-cache');
}

export async function writeResearchCacheSnapshot(cacheRoot: string, snapshot: CleanedSourceSnapshot): Promise<string> {
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const filePath = path.join(cacheRoot, `${snapshot.material_id}-${snapshot.content_sha256}.json`);
  await writeFile(filePath, `${JSON.stringify(snapshot)}\n`, { encoding: 'utf8', mode: 0o600 });
  return filePath;
}

export async function cleanResearchCache(cacheRoot: string, olderThanDays: number, now = new Date()): Promise<number> {
  if (!Number.isInteger(olderThanDays) || olderThanDays < 0) throw new Error('olderThanDays must be a non-negative integer');
  let removed = 0;
  try {
    for (const entry of await readdir(cacheRoot, { withFileTypes: true })) {
      const filePath = path.join(cacheRoot, entry.name);
      const metadata = await stat(filePath);
      if (now.getTime() - metadata.mtimeMs <= olderThanDays * 86_400_000) continue;
      await rm(filePath, { recursive: entry.isDirectory(), force: false });
      removed += 1;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  return removed;
}
