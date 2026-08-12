import Parser from 'rss-parser';
import type { RawFeedItem, SourceConfig } from '../types.js';
import type { Logger } from '../utils/logger.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

export type FetchXml = (url: string, options: { timeoutMs: number; userAgent: string }) => Promise<string>;

export interface RssCollectorOptions {
  timeoutMs: number;
  retries: number;
  userAgent: string;
  fetchXml?: FetchXml;
  retryDelayMs?: number;
  logger?: Logger;
}

export interface MaterialCollector {
  collect(source: SourceConfig): Promise<RawFeedItem[]>;
}

async function fetchXmlWithTimeout(
  url: string,
  { timeoutMs, userAgent }: { timeoutMs: number; userAgent: string },
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9',
        'User-Agent': userAgent,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

interface ParsedItem {
  title?: unknown;
  link?: unknown;
  isoDate?: unknown;
  pubDate?: unknown;
  creator?: unknown;
  author?: unknown;
  contentSnippet?: unknown;
  content?: unknown;
  summary?: unknown;
  contentEncoded?: unknown;
  guid?: unknown;
  id?: unknown;
}

function plainString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = plainString(item);
      if (result) return result;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['name', '_', '#text']) {
      const result = plainString(record[key]);
      if (result) return result;
    }
  }
  return null;
}

export class RssCollector implements MaterialCollector {
  private readonly parser = new Parser({
    customFields: {
      item: [['content:encoded', 'contentEncoded']],
    },
  });

  private readonly fetchXml: FetchXml;
  private readonly log: Logger;

  constructor(private readonly options: RssCollectorOptions) {
    this.fetchXml = options.fetchXml ?? fetchXmlWithTimeout;
    this.log = options.logger ?? defaultLogger;
  }

  async collect(source: SourceConfig): Promise<RawFeedItem[]> {
    const xml = await withRetry(
      () => this.fetchXml(source.url, {
        timeoutMs: this.options.timeoutMs,
        userAgent: this.options.userAgent,
      }),
      {
        retries: this.options.retries,
        ...(this.options.retryDelayMs === undefined ? {} : { delayMs: this.options.retryDelayMs }),
        onRetry: (error, attempt) => {
          this.log.warn('Retrying RSS source', {
            source_id: source.id,
            attempt,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );

    const feed = await this.parser.parseString(xml);
    return (feed.items as ParsedItem[]).map((item) => ({
      title: plainString(item.title) ?? '',
      link: plainString(item.link) ?? '',
      author: plainString(item.creator) ?? plainString(item.author),
      publishedAt: plainString(item.isoDate) ?? plainString(item.pubDate),
      excerpt: plainString(item.contentSnippet)
        ?? plainString(item.summary)
        ?? plainString(item.content)
        ?? plainString(item.contentEncoded)
        ?? '',
      guid: plainString(item.guid) ?? plainString(item.id),
    }));
  }
}
