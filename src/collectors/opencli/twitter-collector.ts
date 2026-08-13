import type { UnifiedMaterial } from '../../types.js';
import { createBrowserMaterial } from './material-factory.js';
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
    const materials: UnifiedMaterial[] = [];
    const failures: OpenCliStatus[] = [];
    const missingFields = new Set<string>();
    const queries = selectRotatedQueries(this.config.queries, Math.min(4, this.config.max_queries_per_run), now);

    for (const query of queries) {
      const limit = Math.min(20, this.config.max_results_per_query);
      const result = await this.runner.run([
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
      commands.push(toCommandSummary(result));
      if (result.status !== 'success') {
        failures.push(result.status);
        if (terminalPlatformStatus(result.status)) break;
        continue;
      }

      try {
        const records = parseTwitterSearch(result.data);
        for (const record of records) {
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
          materials.push(createBrowserMaterial({
            sourcePlatform: 'twitter',
            collector: 'opencli-twitter-rich',
            queryId: query.id,
            queryText: query.query,
            sourceItemId: record.id,
            authorName: record.author,
            authorFollowers: record.author_followers,
            title: record.text.slice(0, 120),
            excerpt: record.text.slice(0, 1_000),
            sourceUrl: record.url,
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
      } catch {
        failures.push('command_failed');
      }
    }

    const status = summarizePlatformStatus(commands.filter((command) => command.status === 'success').length, failures);
    return {
      platform: 'twitter',
      status,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      commands,
      materials,
      missing_fields: [...missingFields].sort(),
      error: [...commands].reverse().find((command) => command.error)?.error ?? null,
    };
  }
}
