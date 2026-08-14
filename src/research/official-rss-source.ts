import Parser from 'rss-parser';
import type { UnifiedMaterial } from '../types.js';
import { extractCleanSource } from './html-extractor.js';
import type { ResearchIntelligenceConfig } from './schemas.js';
import { fetchPublicSource, type SourceFetchOptions } from './source-fetcher.js';
import { sourceIdForMaterial } from './source-materials.js';

type RssItem = {
  title?: string;
  link?: string;
  guid?: string;
  creator?: string;
  author?: string;
  contentEncoded?: string;
  content?: string;
  summary?: string;
  description?: string;
  contentSnippet?: string;
};

const parser = new Parser<Record<string, unknown>, RssItem>({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      'content',
      'summary',
      'description',
      'contentSnippet',
    ],
  },
});

function normalizedIdentity(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return value.normalize('NFKC').trim().replace(/\/+$/, '');
  }
}

function itemContent(item: RssItem): string {
  return [item.contentEncoded, item.content, item.summary, item.description, item.contentSnippet]
    .find((value) => typeof value === 'string' && value.trim() !== '')?.trim() ?? '';
}

function matchesMaterial(item: RssItem, material: UnifiedMaterial): boolean {
  const expected = new Set([
    material.canonical_url,
    material.source_item_id,
    material.source_url,
  ].filter(Boolean).map(normalizedIdentity));
  return [item.link, item.guid]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .some((value) => expected.has(normalizedIdentity(value)));
}

export async function replayOfficialRssItem(input: {
  material: UnifiedMaterial;
  feedUrl: string;
  config: ResearchIntelligenceConfig;
  canonicalFetchStatus: 'blocked' | 'failed';
  canonicalHttpStatus: number | null;
  fallbackReason: string;
  fetchOptions?: SourceFetchOptions;
}) {
  const response = await fetchPublicSource(input.feedUrl, input.config.source_fetch, input.fetchOptions);
  const feed = await parser.parseString(response.body.toString('utf8'));
  const item = feed.items.find((candidate) => matchesMaterial(candidate, input.material));
  if (item === undefined) return null;
  const content = itemContent(item);
  if (content === '') return null;
  return extractCleanSource({
    sourceId: sourceIdForMaterial(input.material.material_id),
    materialId: input.material.material_id,
    body: Buffer.from(content, 'utf8'),
    contentType: /<[^>]+>/.test(content) ? 'text/html' : 'text/plain',
    finalUrl: input.material.canonical_url,
    fallbackTitle: item.title?.trim() || input.material.title,
    fallbackAuthor: item.creator?.trim() || item.author?.trim() || input.material.author_name,
    retrievedAt: response.retrievedAt,
    maximumCleanTextChars: input.config.source_fetch.maximum_clean_text_chars,
    retrievalMethod: 'official_rss_replay',
    contentScope: 'feed_item',
    retrievalUrl: input.feedUrl,
    canonicalFetchStatus: input.canonicalFetchStatus,
    canonicalHttpStatus: input.canonicalHttpStatus,
    fallbackReason: input.fallbackReason,
    snapshotCollectedAt: null,
  });
}
