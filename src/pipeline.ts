import type { Logger } from './utils/logger.js';
import { collectSources } from './collectors/collector-registry.js';
import type { MaterialCollector } from './collectors/rss-collector.js';
import { Deduplicator } from './processors/deduplicate.js';
import { normalizeFeedItem } from './processors/normalize.js';
import { scoreMaterial } from './processors/score-material.js';
import { generateDailyReport, saveDailyReport } from './reports/daily-report.js';
import { MaterialStorage } from './storage/material-storage.js';
import { RunStorage } from './storage/run-storage.js';
import { StateStorage } from './storage/state-storage.js';
import {
  materialSchema,
  runLogSchema,
  type Material,
  type RunLog,
  type ScoringConfig,
  type SourceConfig,
} from './types.js';
import { createRunId } from './utils/time.js';

export interface PipelineOptions {
  rootDir: string;
  date: string;
  sources: SourceConfig[];
  scoring: ScoringConfig;
  collector: MaterialCollector;
  dryRun: boolean;
  logger: Logger;
  clock?: () => Date;
}

export interface PipelineResult {
  run: RunLog;
  newMaterials: Material[];
  report: string;
}

export class AllSourcesFailedError extends Error {
  constructor(public readonly result: PipelineResult) {
    super('All enabled material sources failed');
    this.name = 'AllSourcesFailedError';
  }
}

type PublishDateDisposition = 'recent' | 'stale' | 'unknown';

function classifyPublishDate(publishedAt: string | null, now: Date): PublishDateDisposition {
  if (!publishedAt) return 'unknown';
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return 'unknown';
  return now.getTime() - published.getTime() <= 7 * 24 * 60 * 60 * 1_000 ? 'recent' : 'stale';
}

function emptyEngagement(): Record<'views' | 'likes' | 'comments' | 'shares' | 'reposts' | 'quotes' | 'bookmarks' | 'collects', null> {
  return {
    views: null,
    likes: null,
    comments: null,
    shares: null,
    reposts: null,
    quotes: null,
    bookmarks: null,
    collects: null,
  };
}

export async function runCollectionPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const clock = options.clock ?? (() => new Date());
  const started = clock();
  const enabledSources = options.sources.filter((source) => source.enabled);
  if (enabledSources.length === 0) throw new Error('No enabled material sources');

  options.logger.info('Starting daily material collection', {
    date: options.date,
    sources: enabledSources.length,
    dry_run: options.dryRun,
  });
  const collectedAt = started.toISOString();
  const collectionResults = await collectSources(
    enabledSources,
    options.collector,
    options.scoring.collector.concurrency,
    clock,
  );
  const sourcesSucceeded = collectionResults.filter((result) => result.run.status === 'success').length;
  const stateStorage = new StateStorage(options.rootDir);
  const materialStorage = new MaterialStorage(options.rootDir);
  const runStorage = new RunStorage(options.rootDir);
  const existingState = await stateStorage.load();
  const deduplicator = new Deduplicator(existingState);
  const newMaterials: Material[] = [];
  const extraRejections: Record<string, number> = {};

  if (sourcesSucceeded > 0) {
    for (const result of collectionResults) {
      if (result.run.status === 'failed') {
        options.logger.warn('Material source failed', {
          source_id: result.source.id,
          error: result.run.error,
        });
        continue;
      }

      for (const rawItem of result.items) {
        try {
          const candidate = normalizeFeedItem(
            rawItem,
            result.source,
            collectedAt,
            options.scoring.collector.max_excerpt_chars,
          );
          if (!candidate) {
            result.run.items_rejected += 1;
            extraRejections.invalid_feed_item = (extraRejections.invalid_feed_item ?? 0) + 1;
            continue;
          }

          const duplicateDecision = deduplicator.checkAndAdd(candidate);
          if (duplicateDecision !== 'unique') {
            result.run.items_duplicate += 1;
            continue;
          }

          const publishDateDisposition = classifyPublishDate(candidate.publishedAt, started);
          if (publishDateDisposition === 'stale') {
            result.run.items_rejected += 1;
            extraRejections.older_than_7_days = (extraRejections.older_than_7_days ?? 0) + 1;
            continue;
          }

          const score = scoreMaterial(candidate, options.scoring, started);
          const quarantined = publishDateDisposition === 'unknown';
          const material = materialSchema.parse({
            material_id: `mat_${candidate.urlFingerprint.slice(0, 12)}`,
            source_platform: result.source.type === 'aihot' ? 'aihot' : 'rss',
            source_kind: result.source.type === 'aihot' ? 'news' : result.source.category === 'official_update' ? 'official' : 'news',
            collector: result.source.type === 'aihot' ? 'aihot-v1' : 'rss',
            query_id: '',
            query_text: '',
            search_rank: null,
            source_item_id: rawItem.guid ?? '',
            author_name: candidate.author ?? '',
            author_followers: null,
            title: candidate.title,
            excerpt: candidate.excerpt,
            source_url: candidate.sourceUrl,
            canonical_url: candidate.canonicalUrl,
            content_path: null,
            content_downloaded: false,
            published_at: candidate.publishedAt,
            published_at_quality: quarantined ? 'unknown' : 'exact',
            collected_at: candidate.collectedAt,
            engagement: emptyEngagement(),
            metric_quality: 'unavailable',
            usage_mode: result.source.type === 'aihot' ? 'reference_only' : result.source.source_tier === 'primary' ? 'fact_source' : 'reference_only',
            viral_confidence: 'unverified',
            status: quarantined ? 'quarantined' : score.status,
            rejection_reasons: quarantined
              ? [...new Set([...score.rejectionReasons, 'unknown_publish_date'])]
              : score.rejectionReasons,
            source_id: result.source.id,
            source_name: result.source.name,
            source_type: result.source.type === 'aihot' ? 'api' : 'rss',
            source_tier: result.source.source_tier,
            category: result.source.category,
            author: candidate.author,
            language: result.source.language,
            target_users: result.source.audience_fit,
            tags: score.tags,
            relevance_score: score.relevanceScore,
            freshness_score: score.freshnessScore,
            evidence_score: score.evidenceScore,
            overall_score: score.overallScore,
            fingerprint: candidate.urlFingerprint,
            content_fingerprint: candidate.contentFingerprint,
          });
          newMaterials.push(material);
          if (material.status === 'accepted') result.run.items_new += 1;
          else result.run.items_rejected += 1;
        } catch (error) {
          result.run.items_rejected += 1;
          extraRejections.item_processing_error = (extraRejections.item_processing_error ?? 0) + 1;
          options.logger.warn('Material item was isolated after a processing error', {
            source_id: result.source.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  const finished = clock();
  const failures = collectionResults
    .filter((result) => result.run.status === 'failed')
    .map((result) => ({
      source_id: result.source.id,
      source_name: result.source.name,
      error: result.run.error ?? 'Unknown collection error',
    }));
  const run = runLogSchema.parse({
    run_id: createRunId(started),
    collection_date: options.date,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    status: sourcesSucceeded === 0 ? 'failed' : failures.length > 0 ? 'partial_success' : 'success',
    sources_total: enabledSources.length,
    sources_succeeded: sourcesSucceeded,
    sources_failed: failures.length,
    items_fetched: collectionResults.reduce((sum, result) => sum + result.run.items_fetched, 0),
    items_new: collectionResults.reduce((sum, result) => sum + result.run.items_new, 0),
    items_duplicate: collectionResults.reduce((sum, result) => sum + result.run.items_duplicate, 0),
    items_rejected: collectionResults.reduce((sum, result) => sum + result.run.items_rejected, 0),
    duration_ms: Math.max(0, finished.getTime() - started.getTime()),
    failures,
    source_runs: collectionResults.map((result) => result.run),
  });

  let dailyMaterials: Material[];
  if (!options.dryRun) {
    if (newMaterials.length > 0) {
      await materialStorage.appendUnique(options.date, newMaterials);
    }
    if (sourcesSucceeded > 0) await stateStorage.save(deduplicator.toState(finished.toISOString()));
    await runStorage.save(run);
    dailyMaterials = await materialStorage.readDate(options.date);
  } else {
    const existing = await materialStorage.readDate(options.date);
    dailyMaterials = [...existing, ...newMaterials];
  }

  const report = generateDailyReport({
    date: options.date,
    run,
    dailyMaterials,
    extraRejections,
  });
  if (!options.dryRun) await saveDailyReport(options.rootDir, options.date, report);

  const result = { run, newMaterials, report };
  options.logger.info('Finished daily material collection', {
    run_id: run.run_id,
    status: run.status,
    items_new: run.items_new,
    items_duplicate: run.items_duplicate,
    items_rejected: run.items_rejected,
  });
  if (run.status === 'failed') throw new AllSourcesFailedError(result);
  return result;
}
