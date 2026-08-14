import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTopicMaterialInput, calculateTwitterSignalScores, classifyMaterialRole } from '../src/topic-intelligence/material-input.js';
import { createTopicTestRoot, makeTopicMaterial, topicConfig, writeTopicMaterials } from './topic-test-helpers.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('topic material input and roles', () => {
  it.each([
    [{ source_platform: 'rss', source_kind: 'official' }, 'fact_source'],
    [{ source_platform: 'twitter', source_kind: 'ugc' }, 'trend_signal'],
    [{ source_platform: 'aihot', source_kind: 'news' }, 'reference_only'],
    [{ source_platform: 'weixin', source_kind: 'ugc' }, 'structure_inspiration'],
    [{ source_platform: 'weixin', source_kind: 'official' }, 'fact_source'],
    [{ source_platform: 'weixin', source_access_status: 'unresolved', status: 'quarantined' }, 'restricted_inspiration_only'],
    [{ source_platform: 'weixin', source_access_status: 'resolved', status: 'quarantined' }, 'restricted_inspiration_only'],
  ] as const)('classifies %# as %s', (overrides, role) => {
    expect(classifyMaterialRole(makeTopicMaterial(overrides))).toBe(role);
  });

  async function build(materials: ReturnType<typeof makeTopicMaterial>[]) {
    const root = await createTopicTestRoot(materials);
    roots.push(root);
    return buildTopicMaterialInput(root, '2026-08-14', await topicConfig());
  }

  it('reads recent cloud material', async () => {
    expect((await build([makeTopicMaterial()])).summary.cloud_count).toBe(1);
  });

  it('reads recent browser material', async () => {
    const material = makeTopicMaterial({ material_id: 'mat_bbbbbbbbbbbb', source_platform: 'twitter', source_kind: 'ugc', usage_mode: 'trend_signal' });
    expect((await build([material])).summary.twitter_count).toBe(1);
  });

  it('excludes material older than 72 hours', async () => {
    expect((await build([makeTopicMaterial({ published_at: '2026-08-10T00:00:00.000Z' })])).cards).toHaveLength(0);
  });

  it('excludes future material', async () => {
    expect((await build([makeTopicMaterial({ published_at: '2026-08-14T08:00:00.000Z' })])).cards).toHaveLength(0);
  });

  it('excludes historical xiaohongshu material', async () => {
    expect((await build([makeTopicMaterial({ source_platform: 'xiaohongshu', source_kind: 'ugc' })])).cards).toHaveLength(0);
  });

  it.each(['rejected', 'quarantined'] as const)('does not put %s RSS into input', async (status) => {
    expect((await build([makeTopicMaterial({ status })])).cards).toHaveLength(0);
  });

  it('keeps unresolved Weixin only in restricted pool', async () => {
    const input = await build([makeTopicMaterial({ source_platform: 'weixin', source_kind: 'ugc', source_access_status: 'unresolved', status: 'quarantined' })]);
    expect(input.cards[0]).toMatchObject({ role: 'restricted_inspiration_only', canonical_url: null });
    expect(input.summary.fact_source_count).toBe(0);
  });

  it('does not collapse different unresolved Weixin items through a generic placeholder URL', async () => {
    const first = makeTopicMaterial({ source_platform: 'weixin', source_kind: 'ugc', source_access_status: 'unresolved', status: 'quarantined', canonical_url: 'https://weixin.sogou.com/link', source_item_id: 'discovery:first' });
    const second = makeTopicMaterial({ material_id: 'mat_bbbbbbbbbbbb', source_platform: 'weixin', source_kind: 'ugc', source_access_status: 'unresolved', status: 'quarantined', canonical_url: 'https://weixin.sogou.com/link', source_item_id: 'discovery:second', title: 'A different unresolved user question' });
    expect((await build([first, second])).cards).toHaveLength(2);
  });

  it('caps restricted excerpts at 300 characters', async () => {
    const input = await build([makeTopicMaterial({ source_platform: 'weixin', source_kind: 'ugc', source_access_status: 'unresolved', status: 'quarantined', excerpt: '甲'.repeat(900) })]);
    expect(input.cards[0]?.excerpt).toHaveLength(300);
  });

  it('caps normal excerpts at 500 characters', async () => {
    const input = await build([makeTopicMaterial({ excerpt: 'a'.repeat(900) })]);
    expect(input.cards[0]?.excerpt).toHaveLength(500);
  });

  it('never includes content_path or local paths in cards', async () => {
    const input = await build([makeTopicMaterial({ content_path: '/Users/private/full.md', excerpt: 'read /Users/person/private.md' })]);
    const serialized = JSON.stringify(input.cards);
    expect(serialized).not.toContain('content_path');
    expect(serialized).not.toContain('/Users/');
  });

  it('does not read downloaded Weixin article bodies', async () => {
    const root = await createTopicTestRoot([makeTopicMaterial({ source_platform: 'weixin', source_kind: 'ugc' })]);
    roots.push(root);
    const articleDir = path.join(root, 'data', 'weixin-articles', 'fixture');
    await mkdir(articleDir, { recursive: true });
    await writeFile(path.join(articleDir, 'full.md'), 'SECRET_FULL_ARTICLE_BODY', 'utf8');
    expect(JSON.stringify((await buildTopicMaterialInput(root, '2026-08-14', await topicConfig())).cards)).not.toContain('SECRET_FULL_ARTICLE_BODY');
  });

  it('excludes material containing credential-like content', async () => {
    expect((await build([makeTopicMaterial({ excerpt: 'Authorization: Bearer secret-token-value' })])).cards).toHaveLength(0);
  });

  it('excludes non-restricted material with a non-URL canonical value', async () => {
    expect((await build([makeTopicMaterial({ canonical_url: 'not-a-url' })])).cards).toHaveLength(0);
  });

  it('does not use unknown-time official material as factual input', async () => {
    expect((await build([makeTopicMaterial({ published_at: null, published_at_quality: 'unknown' })])).cards).toHaveLength(0);
  });

  it('conservatively uses collected_at for a non-factual X signal', async () => {
    const input = await build([makeTopicMaterial({ source_platform: 'twitter', source_kind: 'ugc', usage_mode: 'trend_signal', published_at: null, published_at_quality: 'unknown' })]);
    expect(input.cards).toHaveLength(1);
    expect(input.cards[0]?.restrictions).toContain('unknown_publication_time_not_factual');
  });

  it.each(['material_id', 'canonical_url', 'source_item_id'] as const)('deduplicates by %s', async (field) => {
    const first = makeTopicMaterial();
    const second = makeTopicMaterial({
      material_id: field === 'material_id' ? first.material_id : 'mat_bbbbbbbbbbbb',
      canonical_url: field === 'canonical_url' ? first.canonical_url : 'https://example.com/two',
      source_item_id: field === 'source_item_id' ? first.source_item_id : 'two',
    });
    expect((await build([first, second])).cards).toHaveLength(1);
  });

  it('keeps missing interaction metrics as null', async () => {
    const material = makeTopicMaterial({ source_platform: 'twitter', source_kind: 'ugc', usage_mode: 'trend_signal' });
    expect((await build([material])).cards[0]?.engagement.views).toBeNull();
  });

  it('ranks stronger relative X signals above weaker ones without velocity', () => {
    const weak = makeTopicMaterial({ material_id: 'mat_bbbbbbbbbbbb', source_platform: 'twitter', source_kind: 'ugc', usage_mode: 'trend_signal', engagement: { views: 2, likes: 0, comments: 0, shares: null, reposts: 0, quotes: 0, bookmarks: 0, collects: null } });
    const strong = makeTopicMaterial({ material_id: 'mat_cccccccccccc', source_platform: 'twitter', source_kind: 'ugc', usage_mode: 'trend_signal', engagement: { views: 2000, likes: 100, comments: 20, shares: null, reposts: 30, quotes: 2, bookmarks: 60, collects: null } });
    const scores = calculateTwitterSignalScores([weak, strong], Date.parse('2026-08-14T05:00:00Z'), 72);
    expect(scores.get(strong.material_id)).toBeGreaterThan(scores.get(weak.material_id) ?? 0);
    expect(JSON.stringify(scores)).not.toContain('velocity');
  });

  it('marks browser missing when only cloud input exists', async () => {
    expect((await build([makeTopicMaterial()])).summary.source_gaps).toContain('browser_missing');
  });

  it('marks cloud missing when only browser input exists', async () => {
    const material = makeTopicMaterial({ source_platform: 'twitter', source_kind: 'ugc', usage_mode: 'trend_signal' });
    expect((await build([material])).summary.source_gaps).toContain('cloud_missing');
  });

  it('limits a single author to three cards', async () => {
    const materials = Array.from({ length: 6 }, (_, index) => makeTopicMaterial({
      material_id: `mat_${String(index + 1).repeat(12)}`,
      canonical_url: `https://example.com/${index}`,
      source_item_id: `item-${index}`,
      title: `Distinct guide ${index}`,
    }));
    expect((await build(materials)).cards).toHaveLength(3);
  });

  it('limits a single query to eight cards', async () => {
    const titles = ['Zebra archive', 'Quartz notebook', 'Falcon database', 'Lunar canvas', 'Maple calendar', 'Ocean parser', 'Violet editor', 'Copper dashboard', 'Silver inbox', 'Amber checklist'];
    const materials = Array.from({ length: 10 }, (_, index) => makeTopicMaterial({
      material_id: `mat_${(index + 10).toString(16).padStart(12, '0')}`,
      canonical_url: `https://example.com/q/${index}`,
      source_item_id: `q-${index}`,
      author_name: `author-${index}`,
      query_id: 'one-query',
      title: titles[index] ?? `Unique ${index}`,
    }));
    expect((await build(materials)).cards).toHaveLength(8);
  });

  it('limits highly similar title clusters to five', async () => {
    const materials = Array.from({ length: 7 }, (_, index) => makeTopicMaterial({
      material_id: `mat_${(index + 30).toString(16).padStart(12, '0')}`,
      canonical_url: `https://example.com/c/${index}`,
      source_item_id: `c-${index}`,
      author_name: `cluster-author-${index}`,
      query_id: `cluster-query-${index}`,
      title: `OpenAI workflow launch guide version ${index}`,
    }));
    expect((await build(materials)).cards.length).toBeLessThanOrEqual(5);
  });

  it('honors the total input budget', async () => {
    const root = await createTopicTestRoot();
    roots.push(root);
    const config = await topicConfig();
    const materials = Array.from({ length: 70 }, (_, index) => makeTopicMaterial({
      material_id: `mat_${(index + 100).toString(16).padStart(12, '0')}`,
      canonical_url: `https://different.example/${index}`,
      source_item_id: `unique-${index}`,
      author_name: `author-${index}`,
      query_id: `query-${index}`,
      title: `Unique subject ${index} entity${index}`,
    }));
    await writeTopicMaterials(root, materials);
    expect((await buildTopicMaterialInput(root, '2026-08-14', config)).cards.length).toBeLessThanOrEqual(60);
  });
});
