import type { RawFeedItem, SourceConfig } from '../types.js';
import type { Logger } from '../utils/logger.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type { MaterialCollector } from './rss-collector.js';

export type FetchAihotJson = (url: string, options: { timeoutMs: number; userAgent: string }) => Promise<unknown>;

export interface AihotCollectorOptions {
  timeoutMs: number;
  retries: number;
  userAgent: string;
  fetchJson?: FetchAihotJson;
  retryDelayMs?: number;
  logger?: Logger;
}

async function fetchJsonWithTimeout(url: string, options: { timeoutMs: number; userAgent: string }): Promise<unknown> {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://aihot.virxact.com' || !parsed.pathname.startsWith('/api/v1/')) {
    throw new Error('AIHOT collector only permits https://aihot.virxact.com/api/v1/*');
  }
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': options.userAgent },
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.json();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseAihotItems(payload: unknown): RawFeedItem[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as Record<string, unknown>).items)) {
    throw new Error('AIHOT v1 items response is invalid');
  }
  return ((payload as Record<string, unknown>).items as unknown[]).flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    const links = item.links && typeof item.links === 'object' ? item.links as Record<string, unknown> : {};
    const source = item.source && typeof item.source === 'object' ? item.source as Record<string, unknown> : {};
    const title = text(item.title);
    const link = text(links.original) || text(links.aihot);
    if (!title || !link) return [];
    return [{
      title,
      link,
      author: text(source.name) || null,
      publishedAt: text(item.publishedAt) || text(item.discoveredAt) || null,
      excerpt: text(item.summary),
      guid: text(item.id) || null,
    }];
  });
}

export class AihotCollector implements MaterialCollector {
  private readonly fetchJson: FetchAihotJson;
  private readonly log: Logger;

  constructor(private readonly options: AihotCollectorOptions) {
    this.fetchJson = options.fetchJson ?? fetchJsonWithTimeout;
    this.log = options.logger ?? defaultLogger;
  }

  async collect(source: SourceConfig): Promise<RawFeedItem[]> {
    if (source.type !== 'aihot') throw new Error(`AihotCollector cannot collect source type ${source.type}`);
    const payload = await withRetry(
      () => this.fetchJson(source.url, { timeoutMs: this.options.timeoutMs, userAgent: this.options.userAgent }),
      {
        retries: this.options.retries,
        delayMs: this.options.retryDelayMs ?? 250,
        onRetry: (error, attempt) => this.log.warn('Retrying AIHOT source', { source_id: source.id, attempt, error: String(error) }),
      },
    );
    return parseAihotItems(payload);
  }
}
