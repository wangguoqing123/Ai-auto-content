import type { Logger } from '../src/utils/logger.js';
import type { RawFeedItem, SourceConfig } from '../src/types.js';

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function makeSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: 'fixture-source',
    name: 'Fixture Source',
    type: 'rss',
    url: 'https://example.com/feed.xml',
    enabled: true,
    language: 'en',
    category: 'tutorial',
    source_tier: 'primary',
    audience_fit: ['ai_beginner'],
    ...overrides,
  };
}

export function makeRawItem(overrides: Partial<RawFeedItem> = {}): RawFeedItem {
  return {
    title: 'Beginner tutorial: automate a work document with ChatGPT',
    link: 'https://example.com/tutorial?utm_source=test',
    author: 'Fixture Author',
    publishedAt: '2026-08-12T00:00:00.000Z',
    excerpt: 'A step-by-step workflow for content creators and ordinary office tasks.',
    guid: 'fixture-1',
    ...overrides,
  };
}
