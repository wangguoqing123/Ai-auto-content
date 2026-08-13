import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { persistBrowserResult, runBrowserPipeline, type BrowserPipelineResult } from '../src/browser-pipeline.js';
import type { BrowserPlatformResult } from '../src/collectors/opencli/opencli-capability.js';
import { OpenCliRunner, type OpenCliRunResult } from '../src/collectors/opencli/opencli-runner.js';
import { loadPlatformQueries } from '../src/config/load-platform-queries.js';
import { unifiedMaterialSchema } from '../src/types.js';
import { browserMaterial, platformResult } from './opencli-test-helpers.js';

function platform(platform: BrowserPlatformResult['platform']): BrowserPlatformResult {
  return {
    platform,
    status: 'success',
    started_at: '2026-08-12T00:00:00.000Z',
    finished_at: '2026-08-12T00:00:01.000Z',
    commands: [],
    materials: [],
    raw_materials_count: 0,
    materials_count: 0,
    duplicate_materials_count: 0,
    missing_fields: [],
    error: null,
  };
}

describe('browser pipeline isolation', () => {
  it('keeps other platforms running when one collector throws', async () => {
    const preflight: OpenCliRunResult = {
      args: ['doctor'], status: 'success', exit_code: 0, duration_ms: 1, timed_out: false, cancelled: false,
      error: null, stdout: 'ok', stderr: '', data: 'ok',
    };
    const runner = { run: async () => preflight } as unknown as OpenCliRunner;
    const config = await loadPlatformQueries(process.cwd());
    const result = await runBrowserPipeline({
      rootDir: process.cwd(),
      dryRun: true,
      runner,
      config,
      now: new Date('2026-08-12T00:00:00.000Z'),
      collectors: [
        { collect: async () => platform('twitter') },
        { collect: async () => { throw new Error('isolated fixture failure'); } },
        { collect: async () => platform('weixin') },
      ],
    });
    expect(result.status).toBe('partial_success');
    expect(result.platforms.map((entry) => entry.status)).toEqual(['success', 'command_failed', 'success']);
  });

  it('reports raw, unique, and duplicate material counts after pipeline-wide deduplication', async () => {
    const preflight: OpenCliRunResult = {
      args: ['doctor'], status: 'success', exit_code: 0, duration_ms: 1, timed_out: false, cancelled: false,
      error: null, stdout: 'ok', stderr: '', data: 'ok',
    };
    const runner = { run: async () => preflight } as unknown as OpenCliRunner;
    const config = await loadPlatformQueries(process.cwd());
    const duplicateRows = [
      browserMaterial({ queryId: 'query-a', queryText: 'first query' }),
      browserMaterial({ queryId: 'query-b', queryText: 'second query' }),
    ];
    const result = await runBrowserPipeline({
      rootDir: process.cwd(), dryRun: true, runner, config,
      now: new Date('2026-08-13T00:00:00.000Z'),
      collectors: [
        { collect: async () => platformResult('twitter', duplicateRows, 2) },
        { collect: async () => platform('xiaohongshu') },
        { collect: async () => platform('weixin') },
      ],
    });
    expect(result).toMatchObject({ raw_materials_count: 2, materials_count: 1, duplicate_materials_count: 1 });
    expect(result.platforms[0]).toMatchObject({ raw_materials_count: 2, materials_count: 1, duplicate_materials_count: 1 });
    expect(result.platforms[0]?.materials[0]?.query_id).toBe('query-a,query-b');
  });

  it('clears dry-run content paths after cleanup while retaining the download diagnostic', async () => {
    const preflight: OpenCliRunResult = {
      args: ['doctor'], status: 'success', exit_code: 0, duration_ms: 1, timed_out: false, cancelled: false,
      error: null, stdout: 'ok', stderr: '', data: 'ok',
    };
    const runner = { run: async () => preflight } as unknown as OpenCliRunner;
    const config = await loadPlatformQueries(process.cwd());
    const article = browserMaterial({
      sourcePlatform: 'weixin', collector: 'opencli-weixin', sourceItemId: 'article-1',
      canonicalUrl: 'https://mp.weixin.qq.com/s/article-1', sourceUrl: 'https://mp.weixin.qq.com/s/article-1',
      contentPath: '/tmp/removed-after-dry-run/article.md', contentDownloaded: true,
    });
    const result = await runBrowserPipeline({
      rootDir: process.cwd(), dryRun: true, runner, config,
      now: new Date('2026-08-13T00:00:00.000Z'),
      collectors: [
        { collect: async () => platform('twitter') },
        { collect: async () => platform('xiaohongshu') },
        { collect: async () => platformResult('weixin', [article]) },
      ],
    });
    expect(result.platforms[2]?.materials[0]).toMatchObject({ content_path: null, content_downloaded: true });
  });

  it('merges repeated same-day persistence without losing query provenance or fresh metrics', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'ai-auto-content-persistence-'));
    try {
      const first = browserMaterial({
        queryId: 'query-b', queryText: 'second query', searchRank: 5,
        collectedAt: '2026-08-13T01:00:00.000Z', engagement: { likes: 10, views: 100 }, authorFollowers: 50,
      });
      const second = browserMaterial({
        queryId: 'query-a', queryText: 'first query', searchRank: 1,
        collectedAt: '2026-08-13T02:00:00.000Z', engagement: { likes: 20, views: 90 }, authorFollowers: 80,
      });
      const makeResult = (runId: string, material: typeof first): BrowserPipelineResult => ({
        run_id: runId,
        collection_date: '2026-08-13',
        dry_run: false,
        started_at: material.collected_at,
        finished_at: material.collected_at,
        preflight: { args: ['doctor'], status: 'success', exit_code: 0, duration_ms: 1, timed_out: false, cancelled: false, error: null },
        status: 'success',
        platforms: [platformResult('twitter', [material])],
        raw_materials_count: 1,
        materials_count: 1,
        duplicate_materials_count: 0,
      });
      await persistBrowserResult(rootDir, '2026-08-13', makeResult('browser_20260813010000', first));
      await persistBrowserResult(rootDir, '2026-08-13', makeResult('browser_20260813020000', second));

      const lines = (await readFile(path.join(rootDir, 'data/browser-materials/2026-08-13.jsonl'), 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(unifiedMaterialSchema.parse(JSON.parse(lines[0] ?? '{}'))).toMatchObject({
        query_id: 'query-a,query-b',
        query_text: 'first query；second query',
        search_rank: 1,
        author_followers: 80,
        engagement: { likes: 20, views: 100 },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
