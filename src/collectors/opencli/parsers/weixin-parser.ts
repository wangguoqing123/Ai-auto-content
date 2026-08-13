import { parseMetric } from './metric-parser.js';

export interface WeixinSearchRecord {
  rank: number;
  page: number;
  title: string;
  url: string;
  summary: string;
  publish_time: string | null;
  published_at_quality: 'exact' | 'inferred' | 'unknown';
}

export interface WeixinDownloadRecord {
  title: string;
  account_name: string;
  publish_time: string | null;
  status: string;
  markdown_path: string | null;
  published_at_quality: 'exact' | 'unknown';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function chinaDate(parts: RegExpMatchArray): string | null {
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = parts;
  const iso = `${year}-${month?.padStart(2, '0')}-${day?.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}+08:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeDate(
  value: unknown,
  now: Date,
): { value: string | null; quality: 'exact' | 'inferred' | 'unknown' } {
  const raw = stringValue(value);
  if (!raw || raw === '-') return { value: null, quality: 'unknown' };
  const absolute = raw.match(/^(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (absolute) {
    const parsed = chinaDate(absolute);
    return { value: parsed, quality: parsed ? 'exact' : 'unknown' };
  }
  const relative = raw.match(/^(\d+)\s*(分钟|小时|天)前$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = relative[2] === '分钟' ? 60_000 : relative[2] === '小时' ? 3_600_000 : 86_400_000;
    return { value: new Date(now.getTime() - amount * unitMs).toISOString(), quality: 'inferred' };
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? { value: null, quality: 'unknown' }
    : { value: parsed.toISOString(), quality: 'exact' };
}

export function parseWeixinSearch(payload: unknown, now = new Date()): WeixinSearchRecord[] {
  if (!Array.isArray(payload)) throw new Error('Weixin search payload must be an array');
  return payload.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`Weixin search row ${index} is invalid`);
    const row = value as Record<string, unknown>;
    const title = stringValue(row.title);
    const url = stringValue(row.url);
    if (!title || !url) throw new Error(`Weixin search row ${index} lacks title or url`);
    const published = normalizeDate(row.publish_time, now);
    return {
      rank: parseMetric(row.rank) ?? index + 1,
      page: parseMetric(row.page) ?? 1,
      title,
      url,
      summary: stringValue(row.summary),
      publish_time: published.value,
      published_at_quality: published.quality,
    };
  });
}

export function parseWeixinDownload(payload: unknown): WeixinDownloadRecord {
  const value = Array.isArray(payload) ? payload[0] : payload;
  if (!value || typeof value !== 'object') throw new Error('Weixin download payload is invalid');
  const row = value as Record<string, unknown>;
  const status = stringValue(row.status);
  const markdownPath = stringValue(row.saved);
  if (status.toLocaleLowerCase() !== 'success' || !markdownPath || markdownPath === '-') {
    throw new Error(`Weixin download did not succeed: ${status || 'unknown status'}`);
  }
  const published = normalizeDate(row.publish_time, new Date(0));
  return {
    title: stringValue(row.title),
    account_name: stringValue(row.author),
    publish_time: published.value,
    status,
    markdown_path: markdownPath,
    published_at_quality: published.quality === 'exact' ? 'exact' : 'unknown',
  };
}

export function parseWeixinResolvedUrl(payload: unknown): string {
  const value = Array.isArray(payload) ? payload[0] : payload;
  if (!value || typeof value !== 'object') throw new Error('Weixin resolved URL payload is invalid');
  const rawUrl = stringValue((value as Record<string, unknown>).url);
  try {
    const url = new URL(rawUrl);
    if (url.hostname.toLocaleLowerCase() !== 'mp.weixin.qq.com' || url.pathname !== '/s') {
      throw new Error('not a Weixin article URL');
    }
    return url.toString();
  } catch {
    throw new Error('Weixin resolved URL is not an mp.weixin.qq.com article');
  }
}
