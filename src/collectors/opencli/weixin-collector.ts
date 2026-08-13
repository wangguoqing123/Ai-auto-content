import type { UnifiedMaterial } from '../../types.js';
import { createBrowserMaterial } from './material-factory.js';
import {
  summarizePlatformStatus,
  terminalPlatformStatus,
  type BrowserPlatformResult,
  type OpenCliStatus,
} from './opencli-capability.js';
import { OpenCliRunner, toCommandSummary } from './opencli-runner.js';
import type { WeixinCollectorConfig } from './platform-config.js';
import { selectRotatedQueries } from './query-budget.js';
import {
  parseWeixinDownload,
  parseWeixinResolvedUrl,
  parseWeixinSearch,
  type WeixinSearchRecord,
} from './parsers/weixin-parser.js';

export interface WechatViralMetricsProvider {
  readonly status: 'unsupported';
}

export class UnsupportedWechatViralMetricsProvider implements WechatViralMetricsProvider {
  readonly status = 'unsupported' as const;
}

function isDownloadableArticle(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLocaleLowerCase() === 'mp.weixin.qq.com' && parsed.pathname === '/s';
  } catch {
    return false;
  }
}

function isResolvableArticle(url: string): boolean {
  if (isDownloadableArticle(url)) return true;
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLocaleLowerCase() === 'weixin.sogou.com' && parsed.pathname === '/link';
  } catch {
    return false;
  }
}

function selectDownloadCandidates(records: Array<WeixinSearchRecord & { queryId: string }>, maximum: number): Array<WeixinSearchRecord & { queryId: string }> {
  const occurrences = new Map<string, number>();
  for (const record of records) occurrences.set(record.url, (occurrences.get(record.url) ?? 0) + 1);
  return [...records]
    .filter((record) => isResolvableArticle(record.url))
    .sort((left, right) => (occurrences.get(right.url) ?? 0) - (occurrences.get(left.url) ?? 0)
      || Number(Boolean(right.publish_time)) - Number(Boolean(left.publish_time))
      || left.rank - right.rank)
    .filter((record, index, all) => all.findIndex((candidate) => candidate.url === record.url) === index)
    .slice(0, Math.min(5, maximum));
}

export class WeixinCollector {
  readonly viralMetricsProvider: WechatViralMetricsProvider = new UnsupportedWechatViralMetricsProvider();

  constructor(
    private readonly runner: OpenCliRunner,
    private readonly config: WeixinCollectorConfig,
    private readonly outputDirectory: string,
  ) {}

  async collect(now = new Date(), signal?: AbortSignal): Promise<BrowserPlatformResult> {
    const commands = [];
    const failures: OpenCliStatus[] = [];
    const materialById = new Map<string, UnifiedMaterial>();
    const discoveries: Array<WeixinSearchRecord & { queryId: string }> = [];
    const queries = selectRotatedQueries(this.config.queries, Math.min(4, this.config.max_queries_per_run), now);
    let hardStop = false;

    for (const query of queries) {
      const search = await this.runner.run([
        'weixin', 'search', query.query,
        '--page', '1',
        '--limit', String(Math.min(10, this.config.max_results_per_query)),
        '-f', 'json',
      ], { signal });
      commands.push(toCommandSummary(search));
      if (search.status !== 'success') {
        failures.push(search.status);
        if (terminalPlatformStatus(search.status)) {
          hardStop = true;
          break;
        }
        continue;
      }
      try {
        discoveries.push(...parseWeixinSearch(search.data, now).map((record) => ({ ...record, queryId: query.id })));
      } catch {
        failures.push('command_failed');
      }
    }

    for (const candidate of discoveries) {
      const material = createBrowserMaterial({
        sourcePlatform: 'weixin',
        collector: 'opencli-weixin-search',
        queryId: candidate.queryId,
        queryText: queries.find((query) => query.id === candidate.queryId)?.query ?? '',
        searchRank: candidate.rank,
        sourceItemId: '',
        authorName: '',
        title: candidate.title,
        excerpt: candidate.summary.slice(0, 1_000),
        sourceUrl: candidate.url,
        publishedAt: candidate.publish_time,
        publishedAtQuality: candidate.published_at_quality,
        collectedAt: now.toISOString(),
        engagement: {},
        usageMode: 'structure_inspiration',
        viralConfidence: 'unverified',
      });
      const existing = materialById.get(material.material_id);
      if (!existing) materialById.set(material.material_id, material);
      else {
        materialById.set(material.material_id, {
          ...existing,
          query_id: [...new Set([...existing.query_id.split(','), candidate.queryId])].sort().join(','),
          query_text: [...new Set([...existing.query_text.split('；'), material.query_text])].filter(Boolean).sort().join('；'),
          search_rank: Math.min(existing.search_rank ?? candidate.rank, candidate.rank),
        });
      }
    }

    if (!hardStop) {
      for (const candidate of selectDownloadCandidates(discoveries, this.config.max_downloads_per_run)) {
        let articleUrl = candidate.url;
        if (!isDownloadableArticle(articleUrl)) {
          const resolve = await this.runner.run([
            'weixin', 'resolve-article-url',
            '--url', articleUrl,
            '-f', 'json',
          ], { signal, timeoutMs: 30_000 });
          commands.push(toCommandSummary(resolve));
          if (resolve.status !== 'success') {
            failures.push(resolve.status);
            if (terminalPlatformStatus(resolve.status)) break;
            continue;
          }
          try {
            articleUrl = parseWeixinResolvedUrl(resolve.data);
          } catch {
            failures.push('command_failed');
            continue;
          }
        }
        const download = await this.runner.run([
          'weixin', 'download',
          '--url', articleUrl,
          '--output', this.outputDirectory,
          '--download-images', 'false',
          '-f', 'json',
        ], { signal, timeoutMs: 60_000 });
        commands.push(toCommandSummary(download));
        if (download.status !== 'success') {
          failures.push(download.status);
          if (terminalPlatformStatus(download.status)) break;
          continue;
        }
        try {
          const article = parseWeixinDownload(download.data);
          const existing = [...materialById.values()].find((material) => material.source_url === candidate.url);
          const material = createBrowserMaterial({
            sourcePlatform: 'weixin',
            collector: 'opencli-weixin',
            queryId: existing?.query_id ?? candidate.queryId,
            queryText: existing?.query_text ?? queries.find((query) => query.id === candidate.queryId)?.query ?? '',
            searchRank: existing?.search_rank ?? candidate.rank,
            sourceItemId: '',
            authorName: article.account_name,
            title: article.title || candidate.title,
            excerpt: candidate.summary.slice(0, 1_000),
            sourceUrl: articleUrl,
            contentPath: article.markdown_path,
            publishedAt: article.publish_time ?? candidate.publish_time,
            publishedAtQuality: article.publish_time ? article.published_at_quality : candidate.published_at_quality,
            collectedAt: now.toISOString(),
            engagement: {},
            usageMode: 'structure_inspiration',
            viralConfidence: 'unverified',
          });
          if (existing) materialById.delete(existing.material_id);
          materialById.set(material.material_id, material);
        } catch {
          failures.push('command_failed');
        }
      }
    }

    return {
      platform: 'weixin',
      status: summarizePlatformStatus(commands.filter((command) => command.status === 'success').length, failures),
      started_at: now.toISOString(),
      finished_at: new Date().toISOString(),
      commands,
      materials: [...materialById.values()],
      missing_fields: ['views', 'likes', 'comments', 'shares', 'reposts', 'quotes', 'bookmarks', 'collects'],
      error: [...commands].reverse().find((command) => command.error)?.error ?? null,
    };
  }
}
