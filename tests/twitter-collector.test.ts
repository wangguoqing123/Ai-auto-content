import { describe, expect, it } from 'vitest';
import type { OpenCliRunner } from '../src/collectors/opencli/opencli-runner.js';
import type { TwitterCollectorConfig } from '../src/collectors/opencli/platform-config.js';
import { TwitterCollector } from '../src/collectors/opencli/twitter-collector.js';
import { commandResult } from './opencli-test-helpers.js';

const row = {
  id: '1234567890', author: 'fixture', author_followers: 500, text: 'AI workflow fixture',
  created_at: '2026-08-13T01:00:00.000Z', likes: 12, retweets: 3, replies: 2,
  quotes: 1, bookmarks: 4, views: 600, url: 'https://x.com/fixture/status/1234567890',
};

function config(queryCount = 1): TwitterCollectorConfig {
  return {
    max_queries_per_run: queryCount,
    max_results_per_query: 5,
    queries: [
      { id: 'query-a', query: 'AI tools', language: 'en', product: 'top', exclude_replies: true, exclude_retweets: true, minimum_likes: 0, minimum_views: 0, priority: 2, enabled: true },
      { id: 'query-b', query: 'AI coding', language: 'en', product: 'live', exclude_replies: true, exclude_retweets: true, minimum_likes: 0, minimum_views: 0, priority: 1, enabled: true },
    ],
  };
}

describe('Twitter collector rich search fallback', () => {
  it('keeps rich search as the only command when it succeeds and deduplicates across queries', async () => {
    const calls: string[][] = [];
    const runner = { run: async (args: readonly string[]) => {
      calls.push([...args]);
      return commandResult(args, 'success', [row]);
    } } as unknown as OpenCliRunner;
    const result = await new TwitterCollector(runner, config(2)).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(calls.every((args) => args[1] === 'search-rich')).toBe(true);
    expect(result).toMatchObject({ status: 'success', raw_materials_count: 2, materials_count: 1, duplicate_materials_count: 1 });
    expect(result.materials[0]?.query_id).toBe('query-a,query-b');
    expect(result.materials[0]?.query_text).toBe('AI coding；AI tools');
  });

  it('uses basic search after a rich command failure and keeps rich-only fields null', async () => {
    const calls: string[][] = [];
    const runner = { run: async (args: readonly string[]) => {
      calls.push([...args]);
      return args[1] === 'search-rich'
        ? commandResult(args, 'command_failed', null, 'GraphQL Operation changed')
        : commandResult(args, 'success', [row]);
    } } as unknown as OpenCliRunner;
    const result = await new TwitterCollector(runner, config()).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(calls.map((args) => args[1])).toEqual(['search-rich', 'search']);
    expect(calls[1]).toEqual(expect.arrayContaining([
      '--product', 'top', '--limit', '5',
    ]));
    expect(calls[1]?.[2]).toContain('AI tools lang:en since:2026-08-10 -filter:replies -filter:nativeretweets');
    expect(result.status).toBe('partial_success');
    expect(result.materials[0]).toMatchObject({
      collector: 'opencli-twitter-basic',
      author_followers: null,
      engagement: { likes: 12, views: 600, comments: null, reposts: null, quotes: null, bookmarks: null },
    });
    expect(result.missing_fields).toEqual(expect.arrayContaining(['author_followers', 'retweets', 'replies', 'quotes', 'bookmarks']));
  });

  it('preserves product=live and all search operators in basic fallback', async () => {
    const calls: string[][] = [];
    const liveOnly = { ...config(), queries: [config(2).queries[1]!] };
    const runner = { run: async (args: readonly string[]) => {
      calls.push([...args]);
      return args[1] === 'search-rich'
        ? commandResult(args, 'command_failed', null, 'GraphQL Operation changed')
        : commandResult(args, 'success', [row]);
    } } as unknown as OpenCliRunner;
    await new TwitterCollector(runner, liveOnly).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(calls[1]).toEqual(expect.arrayContaining(['--product', 'live', '--limit', '5']));
    expect(calls[1]?.[2]).toContain('AI coding lang:en since:2026-08-10 -filter:replies -filter:nativeretweets');
  });

  it.each([
    ['login_required', 'Not logged into x.com'],
    ['blocked', 'CAPTCHA required'],
  ] as const)('lets fallback terminal status %s override the earlier rich failure', async (status, error) => {
    const runner = { run: async (args: readonly string[]) => args[1] === 'search-rich'
      ? commandResult(args, 'command_failed', null, 'GraphQL Operation changed')
      : commandResult(args, status, null, error) } as unknown as OpenCliRunner;
    const result = await new TwitterCollector(runner, config()).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(result.status).toBe(status);
    expect(result.materials).toHaveLength(0);
  });

  it('uses basic search after a rich payload parser failure', async () => {
    const calls: string[][] = [];
    const runner = { run: async (args: readonly string[]) => {
      calls.push([...args]);
      return commandResult(args, 'success', args[1] === 'search-rich' ? [{ unexpected: true }] : [row]);
    } } as unknown as OpenCliRunner;
    const result = await new TwitterCollector(runner, config()).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(calls.map((args) => args[1])).toEqual(['search-rich', 'search']);
    expect(result.status).toBe('partial_success');
    expect(result.materials[0]?.collector).toBe('opencli-twitter-basic');
  });

  it.each([
    ['login_required', 'Not logged into x.com'],
    ['blocked', 'CAPTCHA required'],
    ['unavailable', 'Browser Bridge extension not connected'],
  ] as const)('does not fallback after %s', async (status, error) => {
    const calls: string[][] = [];
    const runner = { run: async (args: readonly string[]) => {
      calls.push([...args]);
      return commandResult(args, status, null, error);
    } } as unknown as OpenCliRunner;
    const result = await new TwitterCollector(runner, config()).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(status);
    expect(result.materials).toHaveLength(0);
  });

  it('falls back when the custom adapter is not installed', async () => {
    const calls: string[][] = [];
    const runner = { run: async (args: readonly string[]) => {
      calls.push([...args]);
      return args[1] === 'search-rich'
        ? commandResult(args, 'unavailable', null, 'Unknown command: twitter search-rich; adapter not found')
        : commandResult(args, 'success', [row]);
    } } as unknown as OpenCliRunner;
    const result = await new TwitterCollector(runner, config()).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(calls.map((args) => args[1])).toEqual(['search-rich', 'search']);
    expect(result).toMatchObject({ status: 'partial_success', materials_count: 1 });
  });
});
