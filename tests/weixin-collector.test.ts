import { describe, expect, it } from 'vitest';
import type { OpenCliRunResult } from '../src/collectors/opencli/opencli-runner.js';
import { OpenCliRunner } from '../src/collectors/opencli/opencli-runner.js';
import type { WeixinCollectorConfig } from '../src/collectors/opencli/platform-config.js';
import { WeixinCollector } from '../src/collectors/opencli/weixin-collector.js';

function success(args: readonly string[], data: unknown): OpenCliRunResult {
  return {
    args: [...args],
    status: 'success',
    exit_code: 0,
    duration_ms: 1,
    timed_out: false,
    cancelled: false,
    error: null,
    stdout: JSON.stringify(data),
    stderr: '',
    data,
  };
}

describe('Weixin collector live response flow', () => {
  it('resolves Sogou search URLs before downloading and replaces the discovery material', async () => {
    const calls: string[][] = [];
    const runner = {
      run: async (args: readonly string[]) => {
        calls.push([...args]);
        if (args[1] === 'search') return success(args, [{
          rank: 1,
          page: 1,
          title: 'Fixture article',
          url: 'https://weixin.sogou.com/link?url=fixture&type=2&token=fixture',
          summary: 'Fixture summary',
          publish_time: '2小时前',
        }]);
        if (args[1] === 'resolve-article-url') return success(args, [{
          url: 'https://mp.weixin.qq.com/s?src=11&signature=fixture',
        }]);
        if (args[1] === 'download') return success(args, [{
          title: 'Fixture article',
          author: 'Fixture account',
          publish_time: '2026年8月13日 09:01',
          status: 'success',
          size: '1 KB',
          saved: '/tmp/fixture/article.md',
        }]);
        throw new Error(`Unexpected OpenCLI command: ${args.join(' ')}`);
      },
    } as unknown as OpenCliRunner;
    const config: WeixinCollectorConfig = {
      max_queries_per_run: 1,
      max_results_per_query: 1,
      max_downloads_per_run: 1,
      queries: [{ id: 'fixture', query: 'AI工具', priority: 1, enabled: true }],
    };

    const result = await new WeixinCollector(runner, config, '/tmp/fixture').collect(
      new Date('2026-08-13T03:00:00.000Z'),
    );

    expect(result.status).toBe('success');
    expect(calls.map((args) => args.slice(0, 2))).toEqual([
      ['weixin', 'search'],
      ['weixin', 'resolve-article-url'],
      ['weixin', 'download'],
    ]);
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0]).toMatchObject({
      collector: 'opencli-weixin',
      author_name: 'Fixture account',
      source_url: 'https://mp.weixin.qq.com/s?src=11&signature=fixture',
      content_path: '/tmp/fixture/article.md',
      published_at: '2026-08-13T01:01:00.000Z',
      published_at_quality: 'exact',
    });
  });
});
