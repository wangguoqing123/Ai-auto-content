import { describe, expect, it } from 'vitest';
import type { OpenCliRunner } from '../src/collectors/opencli/opencli-runner.js';
import type { XiaohongshuCollectorConfig } from '../src/collectors/opencli/platform-config.js';
import { XiaohongshuCollector } from '../src/collectors/opencli/xiaohongshu-collector.js';
import { commandResult } from './opencli-test-helpers.js';

describe('Xiaohongshu access and canonical URL separation', () => {
  it('uses tokenized access URLs for detail, but persists one token-free material across queries', async () => {
    const noteId = '64f123456789abcdef123456';
    const accessUrls: string[] = [];
    const runner = { run: async (args: readonly string[]) => {
      if (args[1] === 'search') {
        const token = args[2] === 'AI工具' ? 'token-one' : 'token-two';
        return commandResult(args, 'success', [{
          rank: 1, title: '同一篇笔记', author: '作者', likes: 10, published_at: '2026-08-13',
          url: `https://www.xiaohongshu.com/search_result/${noteId}?xsec_token=${token}&xsec_source=pc_search`,
        }]);
      }
      if (args[1] === 'note') {
        accessUrls.push(args[2] ?? '');
        return commandResult(args, 'success', { title: '同一篇笔记', author: '作者', content: '正文', likes: 20, collects: 3, comments: 2, tags: ['AI'] });
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    } } as unknown as OpenCliRunner;
    const config: XiaohongshuCollectorConfig = {
      max_queries_per_run: 2, max_results_per_query: 1, max_details_per_query: 1,
      max_comment_notes_per_run: 0, max_comments_per_note: 0,
      queries: [
        { id: 'xhs-a', query: 'AI工具', priority: 2, enabled: true },
        { id: 'xhs-b', query: 'AI编程', priority: 1, enabled: true },
      ],
    };
    const result = await new XiaohongshuCollector(runner, config).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(accessUrls).toHaveLength(2);
    expect(accessUrls.every((url) => url.includes('xsec_token='))).toBe(true);
    expect(result).toMatchObject({ raw_materials_count: 2, materials_count: 1, duplicate_materials_count: 1 });
    expect(result.materials[0]).toMatchObject({
      source_item_id: noteId,
      source_url: `https://www.xiaohongshu.com/explore/${noteId}`,
      canonical_url: `https://www.xiaohongshu.com/explore/${noteId}`,
      query_id: 'xhs-a,xhs-b',
    });
    expect(JSON.stringify(result)).not.toContain('xsec_token');
    expect(result.commands.flatMap((command) => command.args).join(' ')).not.toContain('token-one');
  });
});
