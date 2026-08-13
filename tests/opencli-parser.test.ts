import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMetric } from '../src/collectors/opencli/parsers/metric-parser.js';
import { parseTwitterSearch } from '../src/collectors/opencli/parsers/twitter-parser.js';
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
      canonicalUrl: resolvedUrl,
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

  it.each([
    ['2小时前', '2026-08-13T01:00:00.000Z', 'inferred'],
    ['3天前', '2026-08-10T03:00:00.000Z', 'inferred'],
    ['2026年8月13日 09:01', '2026-08-13T01:01:00.000Z', 'exact'],
    ['2026-08-13T01:01:00.000Z', '2026-08-13T01:01:00.000Z', 'exact'],
  ])('normalizes Weixin download time %s', (publishTime, expected, quality) => {
    const parsed = parseWeixinDownload([{
      title: 'Fixture', author: 'Account', publish_time: publishTime, status: 'success', saved: '/tmp/article.md',
    }], new Date('2026-08-13T03:00:00.000Z'));
    expect(parsed.publish_time).toBe(expected);
    expect(parsed.published_at_quality).toBe(quality);
    expect(parsed.publish_time).not.toMatch(/^19(?:69|70)-/);
  });

  it.each(['2026-02-31', '2026年2月31日 09:00', '2026-08-13 25:70', '2026-02-31T01:00:00.000Z'])('rejects invalid calendar time %s', (publishTime) => {
    const parsed = parseWeixinDownload([{
      title: 'Fixture', author: 'Account', publish_time: publishTime, status: 'success', saved: '/tmp/article.md',
    }], new Date('2026-08-13T03:00:00.000Z'));
    expect(parsed).toMatchObject({ publish_time: null, published_at_quality: 'unknown' });
  });

  it('isolates one malformed Twitter row when valid rows remain', () => {
    const records = parseTwitterSearch([{ unexpected: true }, {
      id: 'valid-id', author: 'fixture', text: 'valid text', url: 'https://x.com/i/status/valid-id',
    }]);
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('valid-id');
  });
});
