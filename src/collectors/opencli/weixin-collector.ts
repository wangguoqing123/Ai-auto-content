import type { UnifiedMaterial } from '../../types.js';
import { createBrowserMaterial } from './material-factory.js';
import { deduplicateUnifiedMaterials, mergeUnifiedMaterial } from './merge-materials.js';
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
import {
  canonicalizeWeixinArticleUrl,
  deriveWeixinArticleId,
  deriveWeixinSearchId,
  isSogouWeixinRedirectUrl,
  isWeixinArticleUrl,
  sanitizeWeixinDiscoveryUrl,
} from './weixin-url.js';

export interface WechatViralMetricsProvider {
  readonly status: 'unsupported';
}

export class UnsupportedWechatViralMetricsProvider implements WechatViralMetricsProvider {
  readonly status = 'unsupported' as const;
}

interface Discovery extends WeixinSearchRecord {
  queryId: string;
  queryText: string;
}

function isResolvableArticle(url: string): boolean {
  return isWeixinArticleUrl(url) || isSogouWeixinRedirectUrl(url);
}

function discoverySourceItemId(record: WeixinSearchRecord): string {
  if (isWeixinArticleUrl(record.url)) {
    const derived = deriveWeixinArticleId(record.url, {
      accountName: '',
      title: record.title,
      publishedAt: record.publish_time,
      publishedAtQuality: record.published_at_quality,
    });
    if (!derived.startsWith('url:')) return derived;
  }
  return deriveWeixinSearchId(record.title, record.publish_time);
}

function discoveryMaterial(record: Discovery, now: Date): UnifiedMaterial {
  const canonicalUrl = sanitizeWeixinDiscoveryUrl(record.url);
  return createBrowserMaterial({
    sourcePlatform: 'weixin',
    collector: 'opencli-weixin-search',
    queryId: record.queryId,
    queryText: record.queryText,
    searchRank: record.rank,
    sourceItemId: discoverySourceItemId(record),
    authorName: '',
    title: record.title,
    excerpt: record.summary.slice(0, 1_000),
    sourceUrl: canonicalUrl,
    canonicalUrl,
    publishedAt: record.publish_time,
    publishedAtQuality: record.published_at_quality,
    collectedAt: now.toISOString(),
    engagement: {},
    usageMode: 'structure_inspiration',
    viralConfidence: 'unverified',
  });
}

function selectDownloadCandidates(records: Discovery[], maximum: number): Discovery[] {
  const identities = records.map((record) => discoverySourceItemId(record));
  const occurrences = new Map<string, number>();
  for (const identity of identities) occurrences.set(identity, (occurrences.get(identity) ?? 0) + 1);
  return records
    .filter((record) => isResolvableArticle(record.url))
    .sort((left, right) => (occurrences.get(discoverySourceItemId(right)) ?? 0) - (occurrences.get(discoverySourceItemId(left)) ?? 0)
      || Number(Boolean(right.publish_time)) - Number(Boolean(left.publish_time))
      || left.rank - right.rank)
    .filter((record, index, all) => all.findIndex((candidate) => discoverySourceItemId(candidate) === discoverySourceItemId(record)) === index)
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
    const discoveries: Discovery[] = [];
    const queries = selectRotatedQueries(this.config.queries, Math.min(4, this.config.max_queries_per_run), now);
    let hardStop = false;
    let lastParserError: string | null = null;

    const store = (material: UnifiedMaterial): void => {
      const existing = materialById.get(material.material_id);
      materialById.set(material.material_id, existing ? mergeUnifiedMaterial(existing, material) : material);
    };

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
        discoveries.push(...parseWeixinSearch(search.data, now).map((record) => ({
          ...record,
          queryId: query.id,
          queryText: query.query,
        })));
      } catch (error) {
        failures.push('command_failed');
        lastParserError = error instanceof Error ? error.message : String(error);
      }
    }

    for (const candidate of discoveries) store(discoveryMaterial(candidate, now));

    if (!hardStop) {
      for (const candidate of selectDownloadCandidates(discoveries, this.config.max_downloads_per_run)) {
        const provisional = discoveryMaterial(candidate, now);
        const existingProvisional = materialById.get(provisional.material_id) ?? provisional;
        let articleAccessUrl = candidate.url;
        if (!isWeixinArticleUrl(articleAccessUrl)) {
          const resolve = await this.runner.run([
            'weixin', 'resolve-article-url',
            '--url', articleAccessUrl,
            '-f', 'json',
          ], { signal, timeoutMs: 30_000 });
          commands.push(toCommandSummary(resolve));
          if (resolve.status !== 'success') {
            failures.push(resolve.status);
            if (terminalPlatformStatus(resolve.status)) break;
            continue;
          }
          try {
            articleAccessUrl = parseWeixinResolvedUrl(resolve.data);
          } catch (error) {
            failures.push('command_failed');
            lastParserError = error instanceof Error ? error.message : String(error);
            continue;
          }
        }

        const canonicalUrl = canonicalizeWeixinArticleUrl(articleAccessUrl);
        const resolvedIdentity = deriveWeixinArticleId(articleAccessUrl, {
          accountName: '',
          title: candidate.title,
          publishedAt: candidate.publish_time,
          publishedAtQuality: candidate.published_at_quality,
        });
        const resolvedSearch = createBrowserMaterial({
          sourcePlatform: 'weixin',
          collector: 'opencli-weixin-search',
          queryId: existingProvisional.query_id,
          queryText: existingProvisional.query_text,
          searchRank: existingProvisional.search_rank,
          sourceItemId: resolvedIdentity.startsWith('url:') ? discoverySourceItemId(candidate) : resolvedIdentity,
          authorName: '',
          title: candidate.title,
          excerpt: candidate.summary.slice(0, 1_000),
          sourceUrl: canonicalUrl,
          canonicalUrl,
          publishedAt: candidate.publish_time,
          publishedAtQuality: candidate.published_at_quality,
          collectedAt: now.toISOString(),
          engagement: {},
          usageMode: 'structure_inspiration',
          viralConfidence: 'unverified',
        });
        materialById.delete(existingProvisional.material_id);
        store(resolvedSearch);

        const download = await this.runner.run([
          'weixin', 'download',
          '--url', articleAccessUrl,
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
          const article = parseWeixinDownload(download.data, now);
          const resolvedExisting = materialById.get(resolvedSearch.material_id) ?? resolvedSearch;
          const useArticleTime = article.publish_time !== null && article.published_at_quality !== 'unknown';
          const publishedAt = useArticleTime ? article.publish_time : candidate.publish_time;
          const publishedAtQuality = useArticleTime ? article.published_at_quality : candidate.published_at_quality;
          const finalIdentity = deriveWeixinArticleId(articleAccessUrl, {
            accountName: article.account_name,
            title: article.title || candidate.title,
            publishedAt,
            publishedAtQuality,
          });
          const material = createBrowserMaterial({
            sourcePlatform: 'weixin',
            collector: 'opencli-weixin',
            queryId: resolvedExisting.query_id,
            queryText: resolvedExisting.query_text,
            searchRank: resolvedExisting.search_rank,
            sourceItemId: finalIdentity.startsWith('url:') ? resolvedExisting.source_item_id : finalIdentity,
            authorName: article.account_name,
            title: article.title || candidate.title,
            excerpt: candidate.summary.slice(0, 1_000),
            sourceUrl: canonicalUrl,
            canonicalUrl,
            contentPath: article.markdown_path,
            contentDownloaded: true,
            publishedAt,
            publishedAtQuality,
            collectedAt: now.toISOString(),
            engagement: {},
            usageMode: 'structure_inspiration',
            viralConfidence: 'unverified',
          });
          materialById.delete(resolvedExisting.material_id);
          store(material);
        } catch (error) {
          failures.push('command_failed');
          lastParserError = error instanceof Error ? error.message : String(error);
        }
      }
    }

    const materials = deduplicateUnifiedMaterials([...materialById.values()]);
    return {
      platform: 'weixin',
      status: summarizePlatformStatus(commands.filter((command) => command.status === 'success').length, failures),
      started_at: now.toISOString(),
      finished_at: new Date().toISOString(),
      commands,
      materials,
      raw_materials_count: discoveries.length,
      materials_count: materials.length,
      duplicate_materials_count: discoveries.length - materials.length,
      missing_fields: ['views', 'likes', 'comments', 'shares', 'reposts', 'quotes', 'bookmarks', 'collects'],
      error: lastParserError ?? [...commands].reverse().find((command) => command.error)?.error ?? null,
    };
  }
}
