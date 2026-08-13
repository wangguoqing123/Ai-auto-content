import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMetric } from '../src/collectors/opencli/parsers/metric-parser.js';
import { parseTwitterSearch } from '../src/collectors/opencli/parsers/twitter-parser.js';
import {
  parseXiaohongshuComments,
  parseXiaohongshuDetail,
  parseXiaohongshuSearch,
} from '../src/collectors/opencli/parsers/xiaohongshu-parser.js';
import {
  parseWeixinDownload,
  parseWeixinResolvedUrl,
  parseWeixinSearch,
} from '../src/collectors/opencli/parsers/weixin-parser.js';
import { createBrowserMaterial } from '../src/collectors/opencli/material-factory.js';

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(process.cwd(), 'tests', 'fixtures', 'opencli', name), 'utf8')) as unknown;
}

describe('OpenCLI fixture parsers', () => {
  it.each([
    ['123', 123],
    ['1.2万', 12_000],
    ['2w', 20_000],
    ['3千', 3_000],
  ])('parses metric %s', (raw, expected) => {
    expect(parseMetric(raw)).toBe(expected);
  });

  it('parses X rows and keeps unavailable metrics null', async () => {
    const records = parseTwitterSearch(await fixture('twitter-search.json'));
    expect(records[0]).toMatchObject({ retweets: 42, replies: 18, quotes: 7, bookmarks: 91, author_followers: 12_800 });
    expect(records[0]?.media.urls).toHaveLength(1);
    expect(records[1]).toMatchObject({ likes: null, views: null, retweets: null, replies: null, quotes: null, bookmarks: null, author_followers: null });
  });

  it('parses Xiaohongshu search, detail, and nested comment fixtures', async () => {
    const search = parseXiaohongshuSearch(await fixture('xiaohongshu-search.json'));
    const detail = parseXiaohongshuDetail(await fixture('xiaohongshu-detail.json'));
    const comments = parseXiaohongshuComments(await fixture('xiaohongshu-comments.json'));
    expect(search[0]).toMatchObject({ likes: 12_000, published_at_quality: 'inferred' });
    expect(search[0]?.url).toContain('xsec_token=fixture-token-1');
    expect(detail).toMatchObject({ likes: 12_000, collects: 20_000, comments: 123 });
    expect(comments[1]).toMatchObject({ is_reply: true, reply_to: '提问者' });
  });

  it('parses Weixin discovery and downloaded article metadata without inventing engagement', async () => {
    const search = parseWeixinSearch(await fixture('weixin-search.json'), new Date('2026-08-13T02:00:00.000Z'));
    const download = parseWeixinDownload(await fixture('weixin-download.json'));
    const resolvedUrl = parseWeixinResolvedUrl(await fixture('weixin-resolved-url.json'));
    expect(search[0]).toMatchObject({
      rank: 1,
      page: 1,
      publish_time: '2026-08-13T00:00:00.000Z',
      published_at_quality: 'inferred',
    });
    expect(download).toMatchObject({
      account_name: '示例公众号',
      status: 'success',
      publish_time: '2026-08-13T01:01:00.000Z',
      published_at_quality: 'exact',
    });
    expect(resolvedUrl).toContain('https://mp.weixin.qq.com/s?');
    expect(download).not.toHaveProperty('viral_score');
    const material = createBrowserMaterial({
      sourcePlatform: 'weixin',
      collector: 'opencli-weixin',
      queryId: 'fixture',
      sourceItemId: '',
      authorName: download.account_name,
      title: download.title,
      excerpt: search[0]?.summary ?? '',
      sourceUrl: resolvedUrl,
      publishedAt: download.publish_time,
      publishedAtQuality: download.published_at_quality,
      collectedAt: '2026-08-12T01:00:00.000Z',
      engagement: {},
      usageMode: 'structure_inspiration',
      viralConfidence: 'unverified',
    });
    expect(Object.values(material.engagement)).toEqual(Array(8).fill(null));
    expect(material).not.toHaveProperty('viral_score');
    expect(material.viral_confidence).toBe('unverified');
  });

  it('rejects an exit-zero Weixin download payload whose business status failed', () => {
    expect(() => parseWeixinDownload([{
      title: 'Error', author: '-', publish_time: '-', status: 'invalid URL', saved: '-',
    }])).toThrow('did not succeed');
  });
});
