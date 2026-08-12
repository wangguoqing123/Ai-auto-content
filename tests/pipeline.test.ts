import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load-config.js';
import type { MaterialCollector } from '../src/collectors/rss-collector.js';
import { AllSourcesFailedError, runCollectionPipeline } from '../src/pipeline.js';
import { MaterialStorage } from '../src/storage/material-storage.js';
import type { ScoringConfig, SourceConfig } from '../src/types.js';
import { makeRawItem, makeSource, silentLogger } from './helpers.js';

let scoring: ScoringConfig;
const temporaryDirectories: string[] = [];
const fixedClock = () => new Date('2026-08-12T01:00:00.000Z');

beforeAll(async () => {
  scoring = (await loadConfig(process.cwd())).scoring;
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ai-auto-content-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('collection pipeline', () => {
  it('is idempotent on the same day and across days', async () => {
    const rootDir = await tempRoot();
    const source = makeSource();
    const collector: MaterialCollector = { collect: async () => [makeRawItem()] };
    const base = { rootDir, sources: [source], scoring, collector, dryRun: false, logger: silentLogger, clock: fixedClock };

    const first = await runCollectionPipeline({ ...base, date: '2026-08-12' });
    const second = await runCollectionPipeline({ ...base, date: '2026-08-12' });
    const nextDay = await runCollectionPipeline({ ...base, date: '2026-08-13' });
    const storage = new MaterialStorage(rootDir);

    expect(first.run.items_new).toBe(1);
    expect(second.run.items_new).toBe(0);
    expect(second.run.items_duplicate).toBe(1);
    expect(nextDay.run.items_new).toBe(0);
    expect(nextDay.run.items_duplicate).toBe(1);
    expect(await storage.readDate('2026-08-12')).toHaveLength(1);
    expect(await storage.readDate('2026-08-13')).toHaveLength(0);
  });

  it('finishes with partial success when one source fails', async () => {
    const rootDir = await tempRoot();
    const sources = [makeSource({ id: 'good' }), makeSource({ id: 'bad' })];
    const collector: MaterialCollector = {
      collect: async (source: SourceConfig) => source.id === 'bad'
        ? Promise.reject(new Error('source unavailable'))
        : Promise.resolve([makeRawItem()]),
    };
    const result = await runCollectionPipeline({
      rootDir,
      date: '2026-08-12',
      sources,
      scoring,
      collector,
      dryRun: true,
      logger: silentLogger,
      clock: fixedClock,
    });
    expect(result.run.status).toBe('partial_success');
    expect(result.run.sources_succeeded).toBe(1);
    expect(result.run.sources_failed).toBe(1);
  });

  it('fails the task when all sources fail', async () => {
    const rootDir = await tempRoot();
    const collector: MaterialCollector = { collect: async () => { throw new Error('offline'); } };
    await expect(runCollectionPipeline({
      rootDir,
      date: '2026-08-12',
      sources: [makeSource({ id: 'first' }), makeSource({ id: 'second' })],
      scoring,
      collector,
      dryRun: true,
      logger: silentLogger,
      clock: fixedClock,
    })).rejects.toSatisfy((error: unknown) => {
      return error instanceof AllSourcesFailedError && error.result.run.status === 'failed';
    });
  });
});
