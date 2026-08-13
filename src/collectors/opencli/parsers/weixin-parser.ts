import { parseMetric } from './metric-parser.js';
import { isSogouWeixinRedirectUrl, isWeixinArticleUrl } from '../weixin-url.js';

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
  published_at_quality: 'exact' | 'inferred' | 'unknown';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function chinaDate(parts: RegExpMatchArray): string | null {
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = parts;
  if (!validDateParts(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second))) return null;
  const iso = `${year}-${month?.padStart(2, '0')}-${day?.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}+08:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function validDateParts(year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  if (![year, month, day, hour, minute, second].every(Number.isInteger)) return false;
  if (year < 1 || month < 1 || month > 12 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false;
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function strictIsoDate(raw: string): string | null {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0', zone] = match;
  if (!validDateParts(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second))) return null;
  if (zone !== 'Z') {
    const zoneMatch = zone?.match(/^[+-](\d{2}):(\d{2})$/);
    if (!zoneMatch || Number(zoneMatch[1]) > 23 || Number(zoneMatch[2]) > 59) return null;
  }
  const parsed = new Date(raw);
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
  const parsed = strictIsoDate(raw);
  return parsed ? { value: parsed, quality: 'exact' } : { value: null, quality: 'unknown' };
}

export function parseWeixinSearch(payload: unknown, now = new Date()): WeixinSearchRecord[] {
  if (!Array.isArray(payload)) throw new Error('Weixin search payload must be an array');
  const records: WeixinSearchRecord[] = [];
  for (const [index, value] of payload.entries()) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const title = stringValue(row.title);
    const url = stringValue(row.url);
    if (!title || (!isWeixinArticleUrl(url) && !isSogouWeixinRedirectUrl(url))) continue;
    const published = normalizeDate(row.publish_time, now);
    records.push({
      rank: parseMetric(row.rank) ?? index + 1,
      page: parseMetric(row.page) ?? 1,
      title,
      url,
      summary: stringValue(row.summary),
      publish_time: published.value,
      published_at_quality: published.quality,
    });
  }
  if (payload.length > 0 && records.length === 0) throw new Error('Weixin search payload contains no valid rows');
  return records;
}

export function parseWeixinDownload(payload: unknown, now = new Date()): WeixinDownloadRecord {
  const value = Array.isArray(payload) ? payload[0] : payload;
  if (!value || typeof value !== 'object') throw new Error('Weixin download payload is invalid');
  const row = value as Record<string, unknown>;
  const status = stringValue(row.status);
  const markdownPath = stringValue(row.saved);
  if (status.toLocaleLowerCase() !== 'success' || !markdownPath || markdownPath === '-') {
    throw new Error(`Weixin download did not succeed: ${status || 'unknown status'}`);
  }
  const published = normalizeDate(row.publish_time, now);
  return {
    title: stringValue(row.title),
    account_name: stringValue(row.author),
    publish_time: published.value,
    status,
    markdown_path: markdownPath,
    published_at_quality: published.quality,
  };
}

export function parseWeixinResolvedUrl(payload: unknown): string {
  const value = Array.isArray(payload) ? payload[0] : payload;
  if (!value || typeof value !== 'object') throw new Error('Weixin resolved URL payload is invalid');
  const rawUrl = stringValue((value as Record<string, unknown>).url);
  if (!isWeixinArticleUrl(rawUrl)) throw new Error('Weixin resolved URL is not an mp.weixin.qq.com article');
  return new URL(rawUrl).toString();
}
