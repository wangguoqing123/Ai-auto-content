import { createHash } from 'node:crypto';

const STABLE_QUERY_KEYS = ['__biz', 'mid', 'idx', 'sn'] as const;
const ARTICLE_PATH = /^\/s(?:\/([^/]+))?\/?$/;

function parseHttpsUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('URL must use HTTPS without credentials');
  return url;
}

export function isWeixinArticleUrl(rawUrl: string): boolean {
  try {
    const url = parseHttpsUrl(rawUrl);
    return url.hostname.toLocaleLowerCase() === 'mp.weixin.qq.com' && ARTICLE_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

export function isSogouWeixinRedirectUrl(rawUrl: string): boolean {
  try {
    const url = parseHttpsUrl(rawUrl);
    return url.hostname.toLocaleLowerCase() === 'weixin.sogou.com' && url.pathname === '/link';
  } catch {
    return false;
  }
}

export function canonicalizeWeixinArticleUrl(rawUrl: string): string {
  if (!isWeixinArticleUrl(rawUrl)) throw new Error('Invalid Weixin article URL');
  const source = new URL(rawUrl);
  const pathMatch = source.pathname.match(ARTICLE_PATH);
  const slug = pathMatch?.[1];
  const canonical = new URL(`https://mp.weixin.qq.com${source.pathname}`);
  canonical.hash = '';
  if (slug) return canonical.toString();
  for (const key of STABLE_QUERY_KEYS) {
    const value = source.searchParams.get(key);
    if (value) canonical.searchParams.set(key, value);
  }
  return canonical.toString();
}

function normalizedIdentityPart(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface WeixinIdentityMetadata {
  accountName: string;
  title: string;
  publishedAt: string | null;
  publishedAtQuality: 'exact' | 'inferred' | 'unknown';
}

export function deriveWeixinArticleId(rawUrl: string, metadata?: WeixinIdentityMetadata): string {
  const canonical = canonicalizeWeixinArticleUrl(rawUrl);
  const url = new URL(canonical);
  const slug = url.pathname.match(ARTICLE_PATH)?.[1];
  if (slug) return `slug:${decodeURIComponent(slug)}`;

  const business = url.searchParams.get('__biz') ?? '';
  const sn = url.searchParams.get('sn');
  if (sn) return `sn:${business}:${sn}`;
  const mid = url.searchParams.get('mid');
  const idx = url.searchParams.get('idx');
  if (mid && idx) return `message:${business}:${mid}:${idx}`;

  if (metadata?.publishedAt && metadata.publishedAtQuality === 'exact') {
    const fallback = [metadata.accountName, metadata.title, metadata.publishedAt]
      .map(normalizedIdentityPart)
      .join('\n');
    if (normalizedIdentityPart(metadata.accountName) && normalizedIdentityPart(metadata.title)) {
      return `metadata:${digest(fallback)}`;
    }
  }
  return `url:${digest(canonical)}`;
}

export function deriveWeixinSearchId(title: string, publishedAt: string | null): string {
  return `search:${digest(`${normalizedIdentityPart(title)}\n${publishedAt ?? ''}`)}`;
}

export function sanitizeWeixinDiscoveryUrl(rawUrl: string): string {
  if (isWeixinArticleUrl(rawUrl)) return canonicalizeWeixinArticleUrl(rawUrl);
  if (isSogouWeixinRedirectUrl(rawUrl)) return 'https://weixin.sogou.com/link';
  throw new Error('Invalid Weixin discovery URL');
}
