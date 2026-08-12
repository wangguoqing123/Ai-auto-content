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

        const score = scoreMaterial(candidate, options.scoring, started);
        const material = materialSchema.parse({
          material_id: `mat_${candidate.urlFingerprint.slice(0, 12)}`,
          source_id: result.source.id,
          source_name: result.source.name,
          source_type: result.source.type,
          source_tier: result.source.source_tier,
          category: result.source.category,
          title: candidate.title,
          source_url: candidate.sourceUrl,
          canonical_url: candidate.canonicalUrl,
          author: candidate.author,
          published_at: candidate.publishedAt,
          collected_at: candidate.collectedAt,
          language: result.source.language,
          excerpt: candidate.excerpt,
          target_users: result.source.audience_fit,
          tags: score.tags,
          relevance_score: score.relevanceScore,
          freshness_score: score.freshnessScore,
          evidence_score: score.evidenceScore,
          overall_score: score.overallScore,
          fingerprint: candidate.urlFingerprint,
          content_fingerprint: candidate.contentFingerprint,
          status: score.status,
          rejection_reasons: score.rejectionReasons,
        });
        newMaterials.push(material);
        if (material.status === 'accepted') result.run.items_new += 1;
        else result.run.items_rejected += 1;
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
      await stateStorage.save(deduplicator.toState(finished.toISOString()));
    }
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
