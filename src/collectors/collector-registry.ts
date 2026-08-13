import pLimit from 'p-limit';
import type { SourceCollectionResult, SourceConfig } from '../types.js';
import type { MaterialCollector } from './rss-collector.js';

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 500) || 'Unknown collection error';
}

export async function collectSources(
  sources: SourceConfig[],
  collector: MaterialCollector,
  concurrency: number,
  clock: () => Date = () => new Date(),
): Promise<SourceCollectionResult[]> {
  const limit = pLimit(concurrency);

  return Promise.all(sources.map((source) => limit(async () => {
    const startedAt = clock().toISOString();
    try {
      const items = await collector.collect(source);
      return {
        source,
        items,
        run: {
          source_id: source.id,
          source_name: source.name,
          started_at: startedAt,
          finished_at: clock().toISOString(),
          status: 'success' as const,
          items_fetched: items.length,
          items_new: 0,
          items_duplicate: 0,
          items_rejected: 0,
          error: null,
        },
      };
    } catch (error) {
      return {
        source,
        items: [],
        run: {
          source_id: source.id,
          source_name: source.name,
          started_at: startedAt,
          finished_at: clock().toISOString(),
          status: 'failed' as const,
          items_fetched: 0,
          items_new: 0,
          items_duplicate: 0,
          items_rejected: 0,
          error: summarizeError(error),
        },
      };
    }
  })));
}
