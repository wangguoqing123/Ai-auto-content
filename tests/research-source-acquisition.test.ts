import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadResearchIntelligenceConfig } from '../src/research/config.js';
import { replayOfficialRssItem } from '../src/research/official-rss-source.js';
import { acquireResearchSource, acquireResearchSources } from '../src/research/source-acquisition.js';
import { ResearchSourceFetchError } from '../src/research/source-fetcher.js';
import { loadFactSourceMaterials, type ResearchSourceMaterial } from '../src/research/source-materials.js';
import { topicDecisionSchema } from '../src/topic-intelligence/schemas.js';
import type { ResearchIntelligenceConfig } from '../src/research/schemas.js';

let sources: ResearchSourceMaterial[];
let config: ResearchIntelligenceConfig;

beforeAll(async () => {
  const decision = topicDecisionSchema.parse(JSON.parse(await readFile(
    path.join(process.cwd(), 'data/topic-decisions/2026-08-14.json'), 'utf8',
  )) as unknown);
  sources = await loadFactSourceMaterials(process.cwd(), decision, 5);
  config = await loadResearchIntelligenceConfig(process.cwd());
});

function blockedCanonical(): never {
  throw new ResearchSourceFetchError('canonical_access_blocked', 'HTTP 403 challenge', 403);
}

function feedWithFirstItem() {
  const first = sources[0]!.material;
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel><title>OpenAI News</title><link>https://openai.com/news/</link>
        <item><title>${first.title}</title><link>${first.canonical_url}</link>
          <guid>${first.source_item_id}</guid>
          <description><![CDATA[lower priority description]]></description>
          <content:encoded><![CDATA[<p>${first.excerpt}</p>]]></content:encoded>
        </item>
      </channel>
    </rss>`);
}

const publicFetchOptions = () => ({
  resolveHostname: async () => [{ address: '8.8.8.8', family: 4 }],
  request: vi.fn(async (_url: URL, _addresses: Array<{ address: string; family: number }>, _timeoutMs: number, _maximumBytes: number) => ({
    statusCode: 200, location: null, contentType: 'application/rss+xml', body: feedWithFirstItem(),
  })),
  now: () => new Date('2026-08-14T05:30:00.000Z'),
});

describe('first-party research source acquisition', () => {
  it('retains the configured official primary RSS provenance for both current materials', () => {
    expect(sources).toHaveLength(2);
    for (const source of sources) {
      expect(source.material).toMatchObject({ collector: 'rss', source_kind: 'official' });
      expect(source.provenance).toMatchObject({
        source_id: 'openai-news', source_type: 'rss', source_tier: 'primary',
        source_config_url: 'https://openai.com/news/rss.xml',
      });
    }
  });

  it('replays only the matching official RSS item with content:encoded priority', async () => {
    const snapshot = await replayOfficialRssItem({
      material: sources[0]!.material,
      feedUrl: sources[0]!.provenance.source_config_url!,
      config,
      canonicalFetchStatus: 'blocked',
      canonicalHttpStatus: 403,
      fallbackReason: 'canonical_access_blocked',
      fetchOptions: publicFetchOptions(),
    });
    expect(snapshot).toMatchObject({
      retrieval_method: 'official_rss_replay', content_scope: 'feed_item',
      canonical_fetch_status: 'blocked', canonical_http_status: 403,
      retrieval_url: 'https://openai.com/news/rss.xml',
    });
    expect(snapshot?.segments.map(({ text }) => text).join('\n')).toContain(sources[0]!.material.excerpt);
    expect(snapshot?.segments.map(({ text }) => text).join('\n')).not.toContain('lower priority description');
  });

  it('uses RSS replay for a present item and the persisted official excerpt for a missing historical item', async () => {
    const fetchOptions = publicFetchOptions();
    const fetchCanonical = vi.fn(async () => blockedCanonical());
    const acquired = await acquireResearchSources(sources, config, {
      fetchCanonical,
      fetchOptions,
      now: () => new Date('2026-08-14T05:30:00.000Z'),
    });
    expect(acquired.map(({ snapshot }) => snapshot?.retrieval_method)).toEqual([
      'official_rss_replay', 'persisted_official_rss_excerpt',
    ]);
    expect(acquired.map(({ snapshot }) => snapshot?.content_scope)).toEqual(['feed_item', 'feed_excerpt']);
    expect(acquired.every(({ manifest }) => manifest.canonical_fetch_status === 'blocked')).toBe(true);
    expect(acquired.every(({ manifest }) => manifest.canonical_http_status === 403)).toBe(true);
    expect(fetchCanonical).toHaveBeenCalledTimes(2);
    expect(fetchOptions.request).toHaveBeenCalledTimes(2);
    expect(fetchOptions.request.mock.calls.every(([url]) => url.toString() === 'https://openai.com/news/rss.xml')).toBe(true);
  });

  it('does not stop an available source when another source is unavailable', async () => {
    const isolated = [sources[0]!, {
      ...sources[1]!,
      provenance: { ...sources[1]!.provenance, source_config_url: null },
    }];
    const acquired = await acquireResearchSources(isolated, config, {
      fetchCanonical: async () => blockedCanonical(),
      replayRss: async () => null,
      now: () => new Date('2026-08-14T05:30:00.000Z'),
    });
    expect(acquired[0]!.snapshot?.retrieval_method).toBe('persisted_official_rss_excerpt');
    expect(acquired[1]!.snapshot).toBeNull();
    expect(acquired[1]!.manifest).toMatchObject({ fetch_status: 'failed', error_code: 'source_unavailable' });
  });

  it('keeps persisted excerpt hashes stable when only collected_at changes', async () => {
    const first = sources[0]!;
    const changed = { ...first, material: { ...first.material, collected_at: '2026-08-14T00:00:00.000Z' } };
    const acquire = (source: ResearchSourceMaterial) => acquireResearchSource(source, config, {
      fetchCanonical: async () => blockedCanonical(), replayRss: async () => null,
      now: () => new Date('2026-08-14T05:30:00.000Z'),
    });
    const [original, recollected] = await Promise.all([acquire(first), acquire(changed)]);
    expect(original.snapshot?.content_sha256).toBe(recollected.snapshot?.content_sha256);
    expect(original.snapshot?.snapshot_collected_at).not.toBe(recollected.snapshot?.snapshot_collected_at);
  });
});
