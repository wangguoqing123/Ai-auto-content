import type { NormalizedCandidate, RawFeedItem, SourceConfig } from '../types.js';
import { canonicalizeUrl } from './canonicalize-url.js';
import { createContentFingerprint, createUrlFingerprint } from './fingerprint.js';

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  };
  return value.replace(/&(#\d+|#x[\da-f]+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? match;
  });
}

export function toBoundedPlainText(value: string, maxLength: number): string {
  const plain = decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizePublishedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeFeedItem(
  item: RawFeedItem,
  source: SourceConfig,
  collectedAt: string,
  maxExcerptChars: number,
): NormalizedCandidate | null {
  const title = toBoundedPlainText(item.title, 300);
  const sourceUrl = item.link.trim();
  if (!title || !sourceUrl) return null;

  const canonicalUrl = canonicalizeUrl(sourceUrl);
  if (!canonicalUrl) return null;
  const excerpt = toBoundedPlainText(item.excerpt, maxExcerptChars);

  return {
    source,
    title,
    sourceUrl,
    canonicalUrl,
    author: item.author ? toBoundedPlainText(item.author, 200) || null : null,
    publishedAt: normalizePublishedAt(item.publishedAt),
    collectedAt,
    excerpt,
    urlFingerprint: createUrlFingerprint(canonicalUrl),
    contentFingerprint: createContentFingerprint(title, excerpt),
  };
}
