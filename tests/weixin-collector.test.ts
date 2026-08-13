import { describe, expect, it } from 'vitest';
import type { OpenCliRunResult } from '../src/collectors/opencli/opencli-runner.js';
import { OpenCliRunner } from '../src/collectors/opencli/opencli-runner.js';
import type { WeixinCollectorConfig } from '../src/collectors/opencli/platform-config.js';
import { WeixinCollector } from '../src/collectors/opencli/weixin-collector.js';
import { commandResult } from './opencli-test-helpers.js';

function config(queryCount = 1): WeixinCollectorConfig {
  return {
    max_queries_per_run: queryCount,
    max_results_per_query: 1,
    max_downloads_per_run: 1,
    queries: [
      { id: 'weixin-a', query: 'AI工具', priority: 2, enabled: true },
      { id: 'weixin-b', query: 'AI编程', priority: 1, enabled: true },
    ],
  };
}

function searchRow(signature: string) {
  return {
    rank: 1,
    page: 1,
    title: 'Fixture article',
    url: `https://weixin.sogou.com/link?url=fixture&type=2&signature=${signature}`,
    summary: 'Fixture summary',
    publish_time: '2026年8月13日 09:00',
  };
}

describe('Weixin collector live response flow', () => {
  it('keeps access URLs in commands only and stores a canonical article URL', async () => {
    const calls: string[][] = [];
    const runner = {
      run: async (args: readonly string[]): Promise<OpenCliRunResult> => {
        calls.push([...args]);
        if (args[1] === 'search') return commandResult(args, 'success', [searchRow('search-secret')]);
        if (args[1] === 'resolve-article-url') return commandResult(args, 'success', [{
          url: 'https://mp.weixin.qq.com/s?src=11&signature=download-secret',
        }]);
        if (args[1] === 'download') return commandResult(args, 'success', [{
          title: 'Fixture article', author: 'Fixture account', publish_time: '2026年8月13日 09:01',
          status: 'success', size: '1 KB', saved: '/tmp/fixture/article.md',
        }]);
        throw new Error(`Unexpected OpenCLI command: ${args.join(' ')}`);
      },
    } as unknown as OpenCliRunner;

    const result = await new WeixinCollector(runner, config(), '/tmp/fixture').collect(new Date('2026-08-13T03:00:00.000Z'));

    expect(calls.map((args) => args.slice(0, 2))).toEqual([
      ['weixin', 'search'], ['weixin', 'resolve-article-url'], ['weixin', 'download'],
    ]);
    expect(calls.find((args) => args[1] === 'download')?.join(' ')).toContain('download-secret');
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0]).toMatchObject({
      collector: 'opencli-weixin',
      author_name: 'Fixture account',
      source_url: 'https://mp.weixin.qq.com/s',
      canonical_url: 'https://mp.weixin.qq.com/s',
      content_path: '/tmp/fixture/article.md',
      content_downloaded: true,
      published_at: '2026-08-13T01:01:00.000Z',
      published_at_quality: 'exact',
      source_access_status: 'resolved',
      status: 'accepted',
    });
    expect(result.materials[0]?.identity_aliases).toEqual(expect.arrayContaining([
      expect.stringMatching(/^metadata:/),
    ]));
    expect(JSON.stringify(result)).not.toContain('search-secret');
    expect(JSON.stringify(result)).not.toContain('download-secret');
  });

  it('deduplicates the same article across queries and keeps both query sources', async () => {
    const calls: string[][] = [];
    const runner = { run: async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[1] === 'search') return commandResult(args, 'success', [searchRow(args[2] === 'AI工具' ? 'one' : 'two')]);
      if (args[1] === 'resolve-article-url') return commandResult(args, 'success', [{ url: 'https://mp.weixin.qq.com/s?signature=resolved' }]);
      if (args[1] === 'download') return commandResult(args, 'success', [{
        title: 'Fixture article', author: 'Fixture account', publish_time: '2026-08-13T01:00:00.000Z',
        status: 'success', saved: '/tmp/fixture/article.md',
      }]);
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    } } as unknown as OpenCliRunner;
    const result = await new WeixinCollector(runner, config(2), '/tmp/fixture').collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(calls.filter((args) => args[1] === 'resolve-article-url')).toHaveLength(1);
    expect(result).toMatchObject({ raw_materials_count: 2, materials_count: 1, duplicate_materials_count: 1 });
    expect(result.materials[0]?.query_id).toBe('weixin-a,weixin-b');
    expect(result.materials[0]?.query_text).toBe('AI工具；AI编程');
  });

  it('retains the resolved search material when the article body download fails', async () => {
    const runner = { run: async (args: readonly string[]) => {
      if (args[1] === 'search') return commandResult(args, 'success', [searchRow('search')]);
      if (args[1] === 'resolve-article-url') return commandResult(args, 'success', [{ url: 'https://mp.weixin.qq.com/s?signature=resolved' }]);
      if (args[1] === 'download') return commandResult(args, 'command_failed', null, 'article body unavailable');
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    } } as unknown as OpenCliRunner;
    const result = await new WeixinCollector(runner, config(), '/tmp/fixture').collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(result.status).toBe('partial_success');
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0]).toMatchObject({
      collector: 'opencli-weixin-search',
      source_url: 'https://mp.weixin.qq.com/s',
      source_access_status: 'resolved',
      status: 'accepted',
      content_path: null,
      content_downloaded: false,
      published_at: '2026-08-13T01:00:00.000Z',
      published_at_quality: 'exact',
    });
  });

  it('quarantines an unresolved Sogou discovery without persisting its tokenized redirect', async () => {
    const runner = { run: async (args: readonly string[]) => {
      if (args[1] === 'search') return commandResult(args, 'success', [searchRow('unresolved-secret')]);
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    } } as unknown as OpenCliRunner;
    const noDownloads = { ...config(), max_downloads_per_run: 0 };
    const result = await new WeixinCollector(runner, noDownloads, '/tmp/fixture').collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0]).toMatchObject({
      source_url: 'https://weixin.sogou.com/link',
      canonical_url: 'https://weixin.sogou.com/link',
      source_access_status: 'unresolved',
      status: 'quarantined',
      rejection_reasons: ['unresolved_source_url'],
      content_downloaded: false,
      usage_mode: 'structure_inspiration',
      viral_confidence: 'unverified',
    });
    expect(JSON.stringify(result)).not.toContain('unresolved-secret');
  });

  it('falls back to the valid search time when the article time is unknown', async () => {
    const runner = { run: async (args: readonly string[]) => {
      if (args[1] === 'search') return commandResult(args, 'success', [searchRow('search')]);
      if (args[1] === 'resolve-article-url') return commandResult(args, 'success', [{ url: 'https://mp.weixin.qq.com/s?signature=resolved' }]);
      if (args[1] === 'download') return commandResult(args, 'success', [{
        title: 'Fixture article', author: 'Fixture account', publish_time: 'not-a-date',
        status: 'success', saved: '/tmp/fixture/article.md',
      }]);
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    } } as unknown as OpenCliRunner;
    const result = await new WeixinCollector(runner, config(), '/tmp/fixture').collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(result.materials[0]).toMatchObject({
      published_at: '2026-08-13T01:00:00.000Z',
      published_at_quality: 'exact',
    });
  });
});
