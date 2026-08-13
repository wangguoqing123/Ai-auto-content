import { describe, expect, it } from 'vitest';
import { deduplicateUnifiedMaterials, mergeUnifiedMaterial } from '../src/collectors/opencli/merge-materials.js';
import { browserMaterial } from './opencli-test-helpers.js';

describe('browser material identity and merge', () => {
  it('uses a stable source item identity and preserves every query provenance value', () => {
    const first = browserMaterial({
      queryId: 'ai-tools-zh',
      queryText: 'AI工具',
      searchRank: 4,
      canonicalUrl: 'https://x.com/user/status/123?ref=first',
      sourceUrl: 'https://x.com/user/status/123?ref=first',
      authorFollowers: 100,
      engagement: { likes: 10, views: 100 },
      excerpt: 'short',
      publishedAt: '2026-08-13T00:00:00.000Z',
      publishedAtQuality: 'inferred',
      collectedAt: '2026-08-13T02:00:00.000Z',
    });
    const second = browserMaterial({
      queryId: 'ai-coding-en',
      queryText: 'AI coding',
      searchRank: 1,
      canonicalUrl: 'https://x.com/i/status/123',
      sourceUrl: 'https://x.com/i/status/123',
      authorFollowers: 200,
      engagement: { likes: 20, views: 90, comments: 3 },
      excerpt: 'a substantially more complete body of the same material',
      publishedAt: '2026-08-13T01:00:00.000Z',
      publishedAtQuality: 'exact',
      collectedAt: '2026-08-13T03:00:00.000Z',
    });

    expect(first.material_id).toBe(second.material_id);
    expect(mergeUnifiedMaterial(first, second)).toMatchObject({
      query_id: 'ai-coding-en,ai-tools-zh',
      query_text: 'AI coding；AI工具',
      search_rank: 1,
      author_followers: 200,
      excerpt: 'a substantially more complete body of the same material',
      published_at: '2026-08-13T01:00:00.000Z',
      published_at_quality: 'exact',
      collected_at: '2026-08-13T03:00:00.000Z',
      engagement: { likes: 20, views: 100, comments: 3 },
      canonical_url: 'https://x.com/i/status/123',
    });
  });

  it('deduplicates deterministically without allowing the final row to erase earlier queries', () => {
    const materials = deduplicateUnifiedMaterials([
      browserMaterial({ queryId: 'query-b', queryText: 'second query' }),
      browserMaterial({ queryId: 'query-a', queryText: 'first query' }),
    ]);
    expect(materials).toHaveLength(1);
    expect(materials[0]?.query_id).toBe('query-a,query-b');
    expect(materials[0]?.query_text).toBe('first query；second query');
  });
});
