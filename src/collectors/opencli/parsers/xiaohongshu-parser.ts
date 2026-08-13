import { metricWhenPresent, parseMetric } from './metric-parser.js';

export interface XiaohongshuSearchRecord {
  rank: number;
  title: string;
  author: string;
  likes: number | null;
  published_at: string | null;
  published_at_quality: 'inferred';
  url: string;
}

export interface XiaohongshuDetail {
  title: string;
  author: string;
  content: string;
  likes: number | null;
  collects: number | null;
  comments: number | null;
  tags: string[];
}

export interface XiaohongshuComment {
  rank: number;
  author: string;
  text: string;
  likes: number | null;
  time: string;
  is_reply: boolean;
  reply_to: string;
}

function valueText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function hasXsecToken(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return /(^|\.)xiaohongshu\.com$/i.test(url.hostname) && Boolean(url.searchParams.get('xsec_token'));
  } catch {
    return false;
  }
}

function inferredDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T00:00:00+08:00` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseXiaohongshuSearch(payload: unknown): XiaohongshuSearchRecord[] {
  if (!Array.isArray(payload)) throw new Error('Xiaohongshu search payload must be an array');
  return payload.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`Xiaohongshu search row ${index} is invalid`);
    const row = value as Record<string, unknown>;
    const url = valueText(row.url);
    if (!valueText(row.title) || !hasXsecToken(url)) throw new Error(`Xiaohongshu search row ${index} lacks title or xsec_token URL`);
    return {
      rank: parseMetric(row.rank) ?? index + 1,
      title: valueText(row.title),
      author: valueText(row.author),
      likes: metricWhenPresent(row, 'likes'),
      published_at: inferredDate(row.published_at),
      published_at_quality: 'inferred',
      url,
    };
  });
}

export function parseXiaohongshuDetail(payload: unknown): XiaohongshuDetail {
  const fields: Record<string, unknown> = {};
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (entry && typeof entry === 'object') {
        const row = entry as Record<string, unknown>;
        if (typeof row.field === 'string') fields[row.field] = row.value;
      }
    }
  } else if (payload && typeof payload === 'object') {
    Object.assign(fields, payload);
  } else {
    throw new Error('Xiaohongshu detail payload is invalid');
  }
  const tags = Array.isArray(fields.tags)
    ? fields.tags.filter((tag): tag is string => typeof tag === 'string')
    : valueText(fields.tags).split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  return {
    title: valueText(fields.title),
    author: valueText(fields.author),
    content: valueText(fields.content),
    likes: parseMetric(fields.likes),
    collects: parseMetric(fields.collects),
    comments: parseMetric(fields.comments),
    tags,
  };
}

export function parseXiaohongshuComments(payload: unknown): XiaohongshuComment[] {
  if (!Array.isArray(payload)) throw new Error('Xiaohongshu comments payload must be an array');
  return payload.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`Xiaohongshu comment row ${index} is invalid`);
    const row = value as Record<string, unknown>;
    return {
      rank: parseMetric(row.rank) ?? index + 1,
      author: valueText(row.author),
      text: valueText(row.text),
      likes: metricWhenPresent(row, 'likes'),
      time: valueText(row.time),
      is_reply: row.is_reply === true,
      reply_to: valueText(row.reply_to),
    };
  });
}
