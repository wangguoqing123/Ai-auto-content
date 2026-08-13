import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { persistBrowserResult, runBrowserPipeline, type BrowserPipelineResult } from '../src/browser-pipeline.js';
import type { BrowserPlatformResult } from '../src/collectors/opencli/opencli-capability.js';
import { OpenCliRunner, type OpenCliRunResult } from '../src/collectors/opencli/opencli-runner.js';
import type { WeixinCollectorConfig } from '../src/collectors/opencli/platform-config.js';
import { WeixinCollector } from '../src/collectors/opencli/weixin-collector.js';
import { loadPlatformQueries } from '../src/config/load-platform-queries.js';
import { unifiedMaterialSchema } from '../src/types.js';
import { browserMaterial, commandResult, platformResult } from './opencli-test-helpers.js';

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

  it('keeps one Weixin material ID while a cross-run discovery upgrades to downloaded article metadata', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'ai-auto-content-weixin-upgrade-'));
    const firstConfig: WeixinCollectorConfig = {
      max_queries_per_run: 1, max_results_per_query: 1, max_downloads_per_run: 0,
      queries: [{ id: 'first-query', query: 'AI工具', priority: 1, enabled: true }],
    };
    const secondConfig: WeixinCollectorConfig = {
      max_queries_per_run: 1, max_results_per_query: 1, max_downloads_per_run: 1,
      queries: [{ id: 'second-query', query: 'AI编程', priority: 1, enabled: true }],
    };
    const inferredSearchRow = {
      rank: 1, page: 1, title: '跨运行稳定文章',
      url: 'https://weixin.sogou.com/link?signature=temporary',
      summary: '同一段稳定摘要', publish_time: '2小时前',
    };
    const exactSearchRow = {
      ...inferredSearchRow,
      publish_time: '2026年8月13日 09:00',
    };
    const firstRunner = { run: async (args: readonly string[]) => {
      if (args[1] === 'search') return commandResult(args, 'success', [inferredSearchRow]);
      throw new Error(`Unexpected first-run command: ${args.join(' ')}`);
    } } as unknown as OpenCliRunner;
    const secondRunner = { run: async (args: readonly string[]) => {
      if (args[1] === 'search') return commandResult(args, 'success', [exactSearchRow]);
      if (args[1] === 'resolve-article-url') return commandResult(args, 'success', [{
        url: 'https://mp.weixin.qq.com/s?__biz=biz&mid=10&idx=1&sn=stable&signature=temporary',
      }]);
      if (args[1] === 'download') return commandResult(args, 'success', [{
        title: '跨运行稳定文章', author: '稳定公众号', publish_time: '2026年8月13日 09:05',
        status: 'success', saved: '/tmp/fixture/article.md',
      }]);
      throw new Error(`Unexpected second-run command: ${args.join(' ')}`);
    } } as unknown as OpenCliRunner;
    const wrap = (runId: string, platform: BrowserPlatformResult): BrowserPipelineResult => ({
      run_id: runId, collection_date: '2026-08-13', dry_run: false,
      started_at: platform.started_at, finished_at: platform.finished_at,
      preflight: { args: ['doctor'], status: 'success', exit_code: 0, duration_ms: 1, timed_out: false, cancelled: false, error: null },
      status: platform.status === 'success' ? 'success' : 'partial_success',
      platforms: [platform], raw_materials_count: platform.raw_materials_count,
      materials_count: platform.materials_count, duplicate_materials_count: platform.duplicate_materials_count,
    });

    try {
      const first = await new WeixinCollector(firstRunner, firstConfig, '/tmp/fixture').collect(
        new Date('2026-08-13T03:00:00.000Z'),
      );
      const firstMaterial = first.materials[0]!;
      expect(firstMaterial).toMatchObject({
        source_access_status: 'unresolved', status: 'quarantined',
        rejection_reasons: ['unresolved_source_url'], content_downloaded: false,
        published_at_quality: 'inferred',
      });
      await persistBrowserResult(rootDir, '2026-08-13', wrap('browser_20260813030000', first));

      const second = await new WeixinCollector(secondRunner, secondConfig, '/tmp/fixture').collect(
        new Date('2026-08-13T03:10:00.000Z'),
      );
      const downloaded = second.materials[0]!;
      expect(downloaded.material_id).toBe(firstMaterial.material_id);
      expect(downloaded.source_item_id).toBe(firstMaterial.source_item_id);
      expect(downloaded).toMatchObject({
        source_access_status: 'resolved', status: 'accepted', content_downloaded: true,
        canonical_url: 'https://mp.weixin.qq.com/s?__biz=biz&mid=10&idx=1&sn=stable',
        author_name: '稳定公众号', published_at: '2026-08-13T01:05:00.000Z', published_at_quality: 'exact',
      });
      expect(downloaded.identity_aliases).toEqual(expect.arrayContaining(['sn:biz:stable']));
      await persistBrowserResult(rootDir, '2026-08-13', wrap('browser_20260813031000', second));

      const lines = (await readFile(path.join(rootDir, 'data/browser-materials/2026-08-13.jsonl'), 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(1);
      const persisted = unifiedMaterialSchema.parse(JSON.parse(lines[0] ?? '{}'));
      expect(persisted).toMatchObject({
        material_id: firstMaterial.material_id,
        source_item_id: firstMaterial.source_item_id,
        source_access_status: 'resolved',
        status: 'accepted',
        rejection_reasons: [],
        content_downloaded: true,
        canonical_url: 'https://mp.weixin.qq.com/s?__biz=biz&mid=10&idx=1&sn=stable',
        author_name: '稳定公众号',
        published_at: '2026-08-13T01:05:00.000Z',
        published_at_quality: 'exact',
        query_id: 'first-query,second-query',
        query_text: 'AI工具；AI编程',
      });
      expect(persisted.identity_aliases).toEqual(expect.arrayContaining(['sn:biz:stable']));
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
