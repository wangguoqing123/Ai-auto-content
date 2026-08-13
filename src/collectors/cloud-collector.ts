import type { RawFeedItem, SourceConfig } from '../types.js';
import type { AihotCollector } from './aihot-collector.js';
import type { MaterialCollector, RssCollector } from './rss-collector.js';

export class CloudCollector implements MaterialCollector {
  constructor(
    private readonly rss: RssCollector,
    private readonly aihot: AihotCollector,
  ) {}

  collect(source: SourceConfig): Promise<RawFeedItem[]> {
    if (source.type === 'rss') return this.rss.collect(source);
    if (source.type === 'aihot') return this.aihot.collect(source);
    return Promise.reject(new Error(`Unsupported cloud source type: ${String(source.type)}`));
  }
}
