import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTopicMaterialInput } from '../src/topic-intelligence/material-input.js';
import { mergeMaterialSnapshots } from '../src/topic-intelligence/material-snapshots.js';
import { createTopicTestRoot, makeTopicMaterial, topicConfig } from './topic-test-helpers.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function snapshots() {
  const old = makeTopicMaterial({
    material_id: 'mat_111111111111', source_platform: 'weixin', source_kind: 'ugc', usage_mode: 'structure_inspiration',
    source_item_id: 'same-weixin-item', source_access_status: 'unresolved', status: 'quarantined',
    canonical_url: 'https://weixin.sogou.com/link', source_url: 'https://weixin.sogou.com/link',
    query_id: 'old-query', query_text: 'old query', title: 'Older unresolved title', excerpt: 'older excerpt',
    identity_aliases: ['metadata:shared-article'],
    published_at: '2026-08-12T01:00:00.000Z', published_at_quality: 'exact', collected_at: '2026-08-12T02:00:00.000Z',
    engagement: { views: 10, likes: null, comments: null, shares: null, reposts: null, quotes: null, bookmarks: null, collects: null },
  });
  const latest = makeTopicMaterial({
    material_id: 'mat_222222222222', source_platform: 'weixin', source_kind: 'ugc', usage_mode: 'structure_inspiration',
    source_item_id: 'resolved-article-item', source_access_status: 'resolved', status: 'accepted',
    canonical_url: 'https://mp.weixin.qq.com/s/traceable', source_url: 'https://mp.weixin.qq.com/s/traceable',
    query_id: 'new-query', query_text: 'new query', title: 'Latest resolved title', excerpt: 'latest richer excerpt',
    identity_aliases: ['metadata:shared-article', 'article:traceable'],
    published_at: null, published_at_quality: 'unknown', collected_at: '2026-08-13T05:00:00.000Z',
    engagement: { views: null, likes: 20, comments: null, shares: null, reposts: null, quotes: null, bookmarks: null, collects: null },
  });
  return { old, latest };
}

describe('cross-day material snapshot merging', () => {
  it('uses the latest Tweet metrics and falls back only for null metrics', () => {
    const old = makeTopicMaterial({
      material_id: 'mat_333333333333', source_platform: 'twitter', source_kind: 'ugc', usage_mode: 'trend_signal',
      source_item_id: 'tweet-1', canonical_url: 'https://x.com/i/status/1', source_url: 'https://x.com/i/status/1',
      query_id: 'query-a', query_text: 'query a', collected_at: '2026-08-12T02:00:00.000Z',
      engagement: { views: 100, likes: 7, comments: null, shares: null, reposts: null, quotes: null, bookmarks: null, collects: null },
    });
    const latest = makeTopicMaterial({
      ...old, material_id: 'mat_444444444444', query_id: 'query-b', query_text: 'query b',
      collected_at: '2026-08-13T02:00:00.000Z',
      engagement: { ...old.engagement, views: 500, likes: null },
    });
    const [merged] = mergeMaterialSnapshots([old, latest]);
    expect(merged?.engagement).toMatchObject({ views: 500, likes: 7 });
    expect(merged?.query_id.split('|').sort()).toEqual(['query-a', 'query-b']);
    expect(mergeMaterialSnapshots([latest, old])).toEqual([merged]);
  });

  it('keeps the latest resolved snapshot and fills only missing fields from older snapshots', () => {
    const { old, latest } = snapshots();
    const [merged] = mergeMaterialSnapshots([old, latest]);
    expect(merged).toMatchObject({
      source_access_status: 'resolved', status: 'accepted', title: 'Latest resolved title',
      canonical_url: 'https://mp.weixin.qq.com/s/traceable', published_at: old.published_at,
      published_at_quality: 'exact', engagement: { views: 10, likes: 20 },
    });
    expect(merged?.query_id.split('|').sort()).toEqual(['new-query', 'old-query']);
    expect(merged?.identity_aliases).toEqual(expect.arrayContaining([
      'metadata:shared-article', 'article:traceable', 'item:weixin:same-weixin-item', 'item:weixin:resolved-article-item',
    ]));
  });

  it('is independent of snapshot input order', () => {
    const { old, latest } = snapshots();
    expect(mergeMaterialSnapshots([old, latest])).toEqual(mergeMaterialSnapshots([latest, old]));
  });

  it('is independent of JSONL filename ordering', async () => {
    const { old, latest } = snapshots();
    const buildRoot = async (first: typeof old, second: typeof old) => {
      const root = await createTopicTestRoot();
      roots.push(root);
      const directory = path.join(root, 'data', 'browser-materials');
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'a.jsonl'), `${JSON.stringify(first)}\n`, 'utf8');
      await writeFile(path.join(directory, 'z.jsonl'), `${JSON.stringify(second)}\n`, 'utf8');
      return buildTopicMaterialInput(root, '2026-08-14', await topicConfig());
    };
    const left = await buildRoot(old, latest);
    const right = await buildRoot(latest, old);
    expect(left.cards).toEqual(right.cards);
    expect(left.summary).toEqual(right.summary);
    expect(left.cards[0]).toMatchObject({ role: 'structure_inspiration', title: 'Latest resolved title' });
  });
});
