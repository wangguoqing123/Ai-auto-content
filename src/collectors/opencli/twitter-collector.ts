import type { UnifiedMaterial } from '../../types.js';
import { createBrowserMaterial } from './material-factory.js';
import { deduplicateUnifiedMaterials } from './merge-materials.js';
import {
  summarizePlatformStatus,
  terminalPlatformStatus,
  type BrowserPlatformResult,
  type OpenCliStatus,
} from './opencli-capability.js';
import { OpenCliRunner, toCommandSummary } from './opencli-runner.js';
import type { TwitterCollectorConfig, TwitterQueryConfig } from './platform-config.js';
import { selectRotatedQueries } from './query-budget.js';
import { parseTwitterSearch } from './parsers/twitter-parser.js';

function dateDaysAgo(now: Date, days: number): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function buildTwitterQuery(query: TwitterQueryConfig, now: Date): string {
  const operators = [`lang:${query.language}`, `since:${dateDaysAgo(now, 3)}`];
  if (query.exclude_replies) operators.push('-filter:replies');
  if (query.exclude_retweets) operators.push('-filter:nativeretweets');
  return `${query.query} ${operators.join(' ')}`;
}

export class TwitterCollector {
  constructor(
    private readonly runner: OpenCliRunner,
    private readonly config: TwitterCollectorConfig,
  ) {}

  async collect(now = new Date(), signal?: AbortSignal): Promise<BrowserPlatformResult> {
    const startedAt = now.toISOString();
    const commands = [];
    const rawMaterials: UnifiedMaterial[] = [];
    const failures: OpenCliStatus[] = [];
    const missingFields = new Set<string>();
    const queries = selectRotatedQueries(this.config.queries, Math.min(4, this.config.max_queries_per_run), now);
    let lastParserError: string | null = null;

    for (const query of queries) {
      const limit = Math.min(20, this.config.max_results_per_query);
      const rich = await this.runner.run([
        'twitter',
        'search-rich',
        buildTwitterQuery(query, now),
        '--product',
        query.product,
        '--limit',
        String(limit),
        '-f',
        'json',
      ], { signal });
      commands.push(toCommandSummary(rich));

      let records;
      let collector = 'opencli-twitter-rich';
      let needsFallback = false;
      if (rich.status === 'success') {
        try {
          records = parseTwitterSearch(rich.data);
        } catch (error) {
          failures.push('command_failed');
          lastParserError = error instanceof Error ? error.message : String(error);
          needsFallback = true;
        }
      } else {
        failures.push(rich.status);
        const missingAdapter = /unknown command|command not found|adapter.*not found/i.test(rich.error ?? '');
        if (rich.status === 'login_required' || rich.status === 'blocked' || (rich.status === 'unavailable' && !missingAdapter)) break;
        needsFallback = true;
      }

      if (needsFallback) {
        const basic = await this.runner.run([
          'twitter', 'search', buildTwitterQuery(query, now),
          '--limit', String(limit),
          '-f', 'json',
        ], { signal });
        commands.push(toCommandSummary(basic));
        if (basic.status !== 'success') {
          failures.push(basic.status);
          if (terminalPlatformStatus(basic.status)) break;
          continue;
        }
        try {
          records = parseTwitterSearch(basic.data).map((record) => ({
            ...record,
            author_followers: null,
            retweets: null,
            replies: null,
            quotes: null,
            bookmarks: null,
          }));
          collector = 'opencli-twitter-basic';
          for (const field of ['author_followers', 'retweets', 'replies', 'quotes', 'bookmarks']) missingFields.add(field);
        } catch (error) {
          failures.push('command_failed');
          lastParserError = error instanceof Error ? error.message : String(error);
          continue;
        }
      }

      for (const record of records ?? []) {
        if ((record.likes ?? 0) < query.minimum_likes || (record.views ?? 0) < query.minimum_views) continue;
        for (const [field, value] of Object.entries({
          author_followers: record.author_followers,
          retweets: record.retweets,
          replies: record.replies,
          quotes: record.quotes,
          bookmarks: record.bookmarks,
        })) {
          if (value === null) missingFields.add(field);
        }
        const canonicalUrl = `https://x.com/i/status/${record.id}`;
        rawMaterials.push(createBrowserMaterial({
          sourcePlatform: 'twitter',
          collector,
          queryId: query.id,
          queryText: query.query,
          sourceItemId: record.id,
          authorName: record.author,
          authorFollowers: record.author_followers,
          title: record.text.slice(0, 120),
          excerpt: record.text.slice(0, 1_000),
          sourceUrl: canonicalUrl,
          canonicalUrl,
          publishedAt: record.created_at,
          publishedAtQuality: record.created_at ? 'exact' : 'unknown',
          collectedAt: now.toISOString(),
          engagement: {
            views: record.views,
            likes: record.likes,
            comments: record.replies,
            reposts: record.retweets,
            quotes: record.quotes,
            bookmarks: record.bookmarks,
          },
          usageMode: 'trend_signal',
          viralConfidence: 'candidate',
        }));
      }
    }

    const materials = deduplicateUnifiedMaterials(rawMaterials);
    const status = summarizePlatformStatus(commands.filter((command) => command.status === 'success').length, failures);
    return {
      platform: 'twitter',
      status,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      commands,
      materials,
      raw_materials_count: rawMaterials.length,
      materials_count: materials.length,
      duplicate_materials_count: rawMaterials.length - materials.length,
      missing_fields: [...missingFields].sort(),
      error: lastParserError ?? [...commands].reverse().find((command) => command.error)?.error ?? null,
    };
  }
}
