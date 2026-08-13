import { describe, expect, it } from 'vitest';
import { generateDailyReport } from '../src/reports/daily-report.js';
import { materialSchema, runLogSchema } from '../src/types.js';
import { createContentFingerprint, createUrlFingerprint } from '../src/processors/fingerprint.js';

function run(itemsNew: number) {
  return runLogSchema.parse({
    run_id: 'run_20260812_090000',
    collection_date: '2026-08-12',
    started_at: '2026-08-12T01:00:00.000Z',
    finished_at: '2026-08-12T01:00:01.000Z',
    status: 'success',
    sources_total: 1,
    sources_succeeded: 1,
    sources_failed: 0,
    items_fetched: itemsNew,
    items_new: itemsNew,
    items_duplicate: 0,
    items_rejected: 0,
    duration_ms: 1000,
    failures: [],
    source_runs: [],
  });
}

describe('daily report', () => {
  it('clearly reports when there are no qualified materials', () => {
    const report = generateDailyReport({ date: '2026-08-12', run: run(0), dailyMaterials: [] });
    expect(report).toContain('今日没有足够高质量的新素材。');
  });

  it('renders ranked material and deterministic beginner reasons', () => {
    const url = 'https://example.com/tutorial';
    const material = materialSchema.parse({
      material_id: `mat_${createUrlFingerprint(url).slice(0, 12)}`,
      source_platform: 'rss',
      source_kind: 'news',
      collector: 'rss',
      query_id: '',
      query_text: '',
      search_rank: null,
      source_item_id: 'fixture-item',
      author_name: '',
      author_followers: null,
      source_id: 'fixture',
      source_name: 'Fixture Source',
      source_type: 'rss',
      source_tier: 'primary',
      category: 'tutorial',
      title: 'AI video guide',
      source_url: url,
      content_path: null,
      canonical_url: url,
      author: null,
      published_at: '2026-08-12T00:00:00.000Z',
      published_at_quality: 'exact',
      collected_at: '2026-08-12T01:00:00.000Z',
      engagement: { views: null, likes: null, comments: null, shares: null, reposts: null, quotes: null, bookmarks: null, collects: null },
      metric_quality: 'unavailable',
      usage_mode: 'fact_source',
      viral_confidence: 'unverified',
      language: 'en',
      excerpt: 'A practical guide.',
      target_users: ['ai_beginner'],
      tags: ['beginner', 'content_and_video'],
      relevance_score: 80,
      freshness_score: 100,
      evidence_score: 100,
      overall_score: 90,
      fingerprint: createUrlFingerprint(url),
      content_fingerprint: createContentFingerprint('AI video guide', 'A practical guide.'),
      status: 'accepted',
      rejection_reasons: [],
    });
    const report = generateDailyReport({ date: '2026-08-12', run: run(1), dailyMaterials: [material] });
    expect(report).toContain('AI video guide');
    expect(report).toContain('规则依据：');
    expect(report).toContain('综合分：90');
  });
});
