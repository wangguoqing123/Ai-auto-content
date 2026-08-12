import { metricWhenPresent } from './metric-parser.js';

export interface TwitterRecord {
  id: string;
  author: string;
  author_followers: number | null;
  text: string;
  created_at: string | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  quotes: number | null;
  bookmarks: number | null;
  views: number | null;
  url: string;
  media: { has_media: boolean; urls: string[]; posters: string[] };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

export function parseTwitterSearch(payload: unknown): TwitterRecord[] {
  if (!Array.isArray(payload)) throw new Error('Twitter search payload must be an array');
  return payload.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`Twitter row ${index} is not an object`);
    const row = value as Record<string, unknown>;
    const id = text(row.id) || text(row.tweet_id);
    const authorValue = row.author;
    const author = typeof authorValue === 'object' && authorValue
      ? text((authorValue as Record<string, unknown>).username) || text((authorValue as Record<string, unknown>).screen_name)
      : text(authorValue);
    const body = text(row.text) || text(row.full_text);
    const url = text(row.url) || (id ? `https://x.com/i/status/${id}` : '');
    if (!id || !body || !url) throw new Error(`Twitter row ${index} is missing id, text, or url`);
    return {
      id,
      author,
      author_followers: metricWhenPresent(row, 'author_followers', 'followers'),
      text: body,
      created_at: isoDate(row.created_at),
      likes: metricWhenPresent(row, 'likes', 'favorite_count'),
      retweets: metricWhenPresent(row, 'retweets', 'reposts', 'retweet_count'),
      replies: metricWhenPresent(row, 'replies', 'comments', 'reply_count'),
      quotes: metricWhenPresent(row, 'quotes', 'quote_count'),
      bookmarks: metricWhenPresent(row, 'bookmarks', 'bookmark_count'),
      views: metricWhenPresent(row, 'views', 'view_count'),
      url,
      media: {
        has_media: row.has_media === true,
        urls: stringArray(row.media_urls),
        posters: stringArray(row.media_posters),
      },
    };
  });
}
