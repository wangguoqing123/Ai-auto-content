import { parseMetric } from './metric-parser.js';

export interface WeixinSearchRecord {
  rank: number;
  page: number;
  title: string;
  url: string;
  summary: string;
  publish_time: string | null;
}

export interface WeixinDownloadRecord {
  title: string;
  account_name: string;
  publish_time: string | null;
  status: string;
  markdown_path: string | null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDate(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw || raw === '-') return null;
  const withZone = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}+08:00` : raw;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseWeixinSearch(payload: unknown): WeixinSearchRecord[] {
  if (!Array.isArray(payload)) throw new Error('Weixin search payload must be an array');
  return payload.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`Weixin search row ${index} is invalid`);
    const row = value as Record<string, unknown>;
    const title = stringValue(row.title);
    const url = stringValue(row.url);
    if (!title || !url) throw new Error(`Weixin search row ${index} lacks title or url`);
    return {
      rank: parseMetric(row.rank) ?? index + 1,
      page: parseMetric(row.page) ?? 1,
      title,
      url,
      summary: stringValue(row.summary),
      publish_time: normalizeDate(row.publish_time),
    };
  });
}

export function parseWeixinDownload(payload: unknown): WeixinDownloadRecord {
  const value = Array.isArray(payload) ? payload[0] : payload;
  if (!value || typeof value !== 'object') throw new Error('Weixin download payload is invalid');
  const row = value as Record<string, unknown>;
  return {
    title: stringValue(row.title),
    account_name: stringValue(row.author),
    publish_time: normalizeDate(row.publish_time),
    status: stringValue(row.status),
    markdown_path: stringValue(row.saved) || null,
  };
}
