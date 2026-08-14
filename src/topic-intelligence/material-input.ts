import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { unifiedMaterialSchema, type UnifiedMaterial } from '../types.js';
import { normalizeTopicText, tokenJaccard } from './history.js';
import {
  topicMaterialCardSchema,
  type TopicInputSummary,
  type TopicIntelligenceConfig,
  type TopicMaterialCard,
  type TopicMaterialRole,
} from './schemas.js';

interface RankedMaterial {
  material: UnifiedMaterial;
  role: TopicMaterialRole;
  clusterId: string;
  rankScore: number;
  origin: 'cloud' | 'browser';
}

export interface TopicMaterialInput {
  cards: TopicMaterialCard[];
  summary: TopicInputSummary;
  materialById: Map<string, TopicMaterialCard>;
}

async function listJsonlFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function readMaterials(directory: string): Promise<UnifiedMaterial[]> {
  const materials: UnifiedMaterial[] = [];
  for (const filePath of await listJsonlFiles(directory)) {
    const lines = (await readFile(filePath, 'utf8')).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = unifiedMaterialSchema.safeParse(JSON.parse(line) as unknown);
        if (parsed.success) materials.push(parsed.data);
      } catch {
        continue;
      }
    }
  }
  return materials;
}

function hasSensitiveContent(material: UnifiedMaterial): boolean {
  const text = `${material.title}\n${material.excerpt}`;
  return /(?:authorization\s*:|cookie\s*:|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{12,}|session(?:id|_id)?\s*[=:])/iu.test(text);
}

function hasTraceableCanonicalUrl(material: UnifiedMaterial): boolean {
  try {
    const url = new URL(material.canonical_url);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function classifyMaterialRole(material: UnifiedMaterial): TopicMaterialRole {
  if (material.source_platform === 'weixin'
    && (material.source_access_status === 'unresolved' || material.status === 'quarantined')) {
    return 'restricted_inspiration_only';
  }
  if (material.source_platform === 'twitter') return 'trend_signal';
  if (material.source_platform === 'aihot') return 'reference_only';
  if (material.source_platform === 'weixin') {
    return material.source_kind === 'official' ? 'fact_source' : 'structure_inspiration';
  }
  if (material.source_kind === 'official'
    && material.source_access_status === 'resolved'
    && material.status === 'accepted') return 'fact_source';
  return 'reference_only';
}

function referenceTime(decisionDate: string, targetTime: string): number {
  return new Date(`${decisionDate}T${targetTime}:00+08:00`).getTime();
}

function materialTimestamp(material: UnifiedMaterial, role: TopicMaterialRole): { time: number; conservative: boolean } | null {
  if (material.published_at !== null && material.published_at_quality !== 'unknown') {
    const time = Date.parse(material.published_at);
    return Number.isNaN(time) ? null : { time, conservative: false };
  }
  if (role === 'trend_signal' || role === 'structure_inspiration' || role === 'restricted_inspiration_only') {
    const time = Date.parse(material.collected_at);
    return Number.isNaN(time) ? null : { time, conservative: true };
  }
  return null;
}

function isInsideWindow(
  material: UnifiedMaterial,
  role: TopicMaterialRole,
  decisionDate: string,
  config: TopicIntelligenceConfig,
): boolean {
  const reference = referenceTime(decisionDate, config.schedule.target_time);
  const timestamp = materialTimestamp(material, role);
  if (timestamp === null || timestamp.time > reference) return false;
  return reference - timestamp.time <= config.input.lookback_hours * 60 * 60 * 1_000;
}

function safeExcerpt(value: string, maximum: number): string {
  return value
    .replace(/(?:authorization\s*:|cookie\s*:|bearer\s+|sk-)[^\s]+/giu, '[redacted]')
    .replace(/\/Users\/[A-Za-z0-9._-]+\/[^\s]*/gu, '[local-path-redacted]')
    .slice(0, maximum);
}

function recencyScore(material: UnifiedMaterial, role: TopicMaterialRole, decisionTime: number, lookbackHours: number): number {
  const timestamp = materialTimestamp(material, role)?.time ?? decisionTime - lookbackHours * 3_600_000;
  const ageHours = Math.max(0, (decisionTime - timestamp) / 3_600_000);
  return Math.max(0, 1 - ageHours / lookbackHours);
}

function percentile(values: Array<number | null>, value: number | null): number {
  if (value === null) return 0;
  const available = values.filter((item): item is number => item !== null).map((item) => Math.log1p(item)).sort((a, b) => a - b);
  if (available.length <= 1) return available.length === 1 ? 1 : 0;
  const transformed = Math.log1p(value);
  let lessOrEqual = 0;
  for (const item of available) if (item <= transformed) lessOrEqual += 1;
  return (lessOrEqual - 1) / (available.length - 1);
}

export function calculateTwitterSignalScores(materials: UnifiedMaterial[], decisionTime: number, lookbackHours: number): Map<string, number> {
  const twitter = materials.filter((material) => material.source_platform === 'twitter');
  const fields = {
    views: twitter.map(({ engagement }) => engagement.views),
    likes: twitter.map(({ engagement }) => engagement.likes),
    comments: twitter.map(({ engagement }) => engagement.comments),
    reposts: twitter.map(({ engagement }) => engagement.reposts),
  };
  return new Map(twitter.map((material) => [material.material_id,
    0.35 * recencyScore(material, 'trend_signal', decisionTime, lookbackHours)
    + 0.25 * percentile(fields.views, material.engagement.views)
    + 0.20 * percentile(fields.likes, material.engagement.likes)
    + 0.10 * percentile(fields.comments, material.engagement.comments)
    + 0.10 * percentile(fields.reposts, material.engagement.reposts),
  ]));
}

function clusterMaterials(materials: Array<{ material: UnifiedMaterial; role: TopicMaterialRole }>): Map<string, string> {
  const clusters: Array<{ id: string; title: string; entities: Set<string> }> = [];
  const mapping = new Map<string, string>();
  for (const { material } of materials) {
    const normalized = normalizeTopicText(material.title);
    const entities = new Set(material.title.match(/[A-Z][A-Za-z0-9.-]{2,}|[\p{Script=Han}]{2,8}/gu) ?? []);
    const existing = clusters.find((cluster) => {
      const entityOverlap = [...entities].some((entity) => cluster.entities.has(entity));
      return tokenJaccard(normalized, cluster.title) >= 0.72
        || (entityOverlap && tokenJaccard(normalized, cluster.title) >= 0.45);
    });
    if (existing !== undefined) {
      mapping.set(material.material_id, existing.id);
      for (const entity of entities) existing.entities.add(entity);
    } else {
      const id = `cluster_${clusters.length + 1}`;
      clusters.push({ id, title: normalized, entities });
      mapping.set(material.material_id, id);
    }
  }
  return mapping;
}

function toCard(material: UnifiedMaterial, role: TopicMaterialRole, config: TopicIntelligenceConfig): TopicMaterialCard {
  const restricted = role === 'restricted_inspiration_only';
  const restrictions: string[] = [];
  if (restricted) restrictions.push('restricted_inspiration_only', 'not_fact_evidence', 'no_full_article');
  if (material.source_platform === 'twitter') restrictions.push('ugc_signal_only', 'no_velocity_claim');
  if (material.source_platform === 'aihot') restrictions.push('secondary_reference_requires_verification');
  if (material.published_at_quality === 'unknown') restrictions.push('unknown_publication_time_not_factual');
  return topicMaterialCardSchema.parse({
    material_id: material.material_id,
    source_platform: material.source_platform,
    source_kind: material.source_kind,
    role,
    title: safeExcerpt(material.title, 1_000) || '(untitled material)',
    excerpt: safeExcerpt(
      material.excerpt,
      restricted ? config.input.restricted_excerpt_max_chars : config.input.excerpt_max_chars,
    ),
    author_name: safeExcerpt(material.author_name, 300),
    published_at: material.published_at,
    published_at_quality: material.published_at_quality,
    canonical_url: restricted ? null : material.canonical_url,
    query_id: material.query_id,
    query_text: safeExcerpt(material.query_text, 500),
    engagement: {
      views: material.engagement.views,
      likes: material.engagement.likes,
      comments: material.engagement.comments,
      reposts: material.engagement.reposts,
      quotes: material.engagement.quotes,
      bookmarks: material.engagement.bookmarks,
    },
    usage_mode: material.usage_mode,
    restrictions,
  });
}

function deterministicSelect(ranked: RankedMaterial[], config: TopicIntelligenceConfig): RankedMaterial[] {
  const selected: RankedMaterial[] = [];
  const authorCounts = new Map<string, number>();
  const queryCounts = new Map<string, number>();
  const clusterCounts = new Map<string, number>();
  const platformCounts = new Map<string, number>();
  const roleBuckets = new Map<TopicMaterialRole, RankedMaterial[]>();
  for (const item of ranked.sort((left, right) => right.rankScore - left.rankScore || left.material.material_id.localeCompare(right.material.material_id))) {
    const bucket = roleBuckets.get(item.role) ?? [];
    bucket.push(item);
    roleBuckets.set(item.role, bucket);
  }
  const roleOrder: TopicMaterialRole[] = [
    'fact_source', 'trend_signal', 'reference_only', 'structure_inspiration', 'restricted_inspiration_only',
  ];
  let madeProgress = true;
  while (selected.length < config.input.max_total_materials && madeProgress) {
    madeProgress = false;
    for (const role of roleOrder) {
      const bucket = roleBuckets.get(role) ?? [];
      while (bucket.length > 0) {
        const item = bucket.shift();
        if (item === undefined) break;
        const author = normalizeTopicText(item.material.author_name) || `unknown:${item.material.material_id}`;
        const query = item.material.query_id || '(no-query)';
        const platform = item.material.source_platform;
        const platformMaximum = platform === 'twitter'
          ? config.input.max_twitter_materials
          : platform === 'weixin' && role === 'restricted_inspiration_only'
            ? config.input.max_weixin_restricted_materials
            : platform === 'weixin'
              ? config.input.max_weixin_resolved_materials
              : config.input.max_cloud_materials;
        if ((authorCounts.get(author) ?? 0) >= config.input.max_per_author
          || (queryCounts.get(query) ?? 0) >= config.input.max_per_query
          || (clusterCounts.get(item.clusterId) ?? 0) >= config.input.max_per_cluster
          || (platformCounts.get(platform) ?? 0) >= platformMaximum) continue;
        selected.push(item);
        authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
        queryCounts.set(query, (queryCounts.get(query) ?? 0) + 1);
        clusterCounts.set(item.clusterId, (clusterCounts.get(item.clusterId) ?? 0) + 1);
        platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1);
        madeProgress = true;
        break;
      }
      if (selected.length >= config.input.max_total_materials) break;
    }
  }
  return selected;
}

export async function buildTopicMaterialInput(
  rootDir: string,
  decisionDate: string,
  config: TopicIntelligenceConfig,
): Promise<TopicMaterialInput> {
  const [cloud, browser] = await Promise.all([
    readMaterials(path.join(rootDir, 'data', 'materials')),
    readMaterials(path.join(rootDir, 'data', 'browser-materials')),
  ]);
  const totalBeforeFilter = cloud.length + browser.length;
  const dedupeKeys = new Set<string>();
  const usable: Array<{ material: UnifiedMaterial; role: TopicMaterialRole; origin: 'cloud' | 'browser' }> = [];
  for (const [origin, materials] of [['cloud', cloud], ['browser', browser]] as const) {
    for (const material of materials) {
      if (material.source_platform === 'xiaohongshu' || hasSensitiveContent(material)) continue;
      const role = classifyMaterialRole(material);
      const restricted = role === 'restricted_inspiration_only';
      if (!restricted && material.status !== 'accepted') continue;
      if (!restricted && material.source_access_status !== 'resolved') continue;
      if (!restricted && !hasTraceableCanonicalUrl(material)) continue;
      if (!isInsideWindow(material, role, decisionDate, config)) continue;
      if (role === 'fact_source' && material.published_at_quality === 'unknown') continue;
      const identityKeys = [
        `id:${material.material_id}`,
        material.source_access_status === 'resolved' && material.canonical_url ? `url:${material.canonical_url}` : '',
        material.source_item_id ? `item:${material.source_platform}:${material.source_item_id}` : '',
      ].filter(Boolean);
      if (identityKeys.some((key) => dedupeKeys.has(key))) continue;
      for (const key of identityKeys) dedupeKeys.add(key);
      usable.push({ material, role, origin });
    }
  }

  const decisionTime = referenceTime(decisionDate, config.schedule.target_time);
  const twitterScores = calculateTwitterSignalScores(usable.map(({ material }) => material), decisionTime, config.input.lookback_hours);
  const clusters = clusterMaterials(usable);
  const ranked: RankedMaterial[] = usable.map(({ material, role, origin }) => {
    const officialBonus = role === 'fact_source' ? 0.30 : 0;
    const relevance = 'overall_score' in material && typeof material.overall_score === 'number'
      ? material.overall_score / 100 : 0.5;
    const fresh = recencyScore(material, role, decisionTime, config.input.lookback_hours);
    const rankScore = material.source_platform === 'twitter'
      ? twitterScores.get(material.material_id) ?? 0
      : material.source_platform === 'weixin'
        ? 0.50 * fresh + (material.source_access_status === 'resolved' ? 0.25 : 0) + (material.content_downloaded ? 0.15 : 0)
          + (material.search_rank === null ? 0 : 0.10 / material.search_rank)
        : 0.45 * relevance + 0.25 * fresh + officialBonus;
    return { material, role, origin, clusterId: clusters.get(material.material_id) ?? material.material_id, rankScore };
  });

  const selected = deterministicSelect(ranked, config);
  const cards: TopicMaterialCard[] = [];
  let inputCharacters = 0;
  for (const item of selected) {
    const card = toCard(item.material, item.role, config);
    const characters = JSON.stringify(card).length;
    if (inputCharacters + characters > config.input.max_model_input_chars) continue;
    cards.push(card);
    inputCharacters += characters;
  }
  const count = (predicate: (card: TopicMaterialCard) => boolean) => cards.filter(predicate).length;
  const summary: TopicInputSummary = {
    total_before_filter: totalBeforeFilter,
    total_after_filter: cards.length,
    cloud_count: count((card) => card.source_platform === 'rss' || card.source_platform === 'aihot'),
    twitter_count: count((card) => card.source_platform === 'twitter'),
    weixin_resolved_count: count((card) => card.source_platform === 'weixin' && card.role !== 'restricted_inspiration_only'),
    restricted_count: count((card) => card.role === 'restricted_inspiration_only'),
    fact_source_count: count((card) => card.role === 'fact_source'),
    trend_signal_count: count((card) => card.role === 'trend_signal'),
    structure_inspiration_count: count((card) => card.role === 'structure_inspiration'),
    source_gaps: [
      ...(browser.length === 0 || count((card) => card.source_platform === 'twitter' || card.source_platform === 'weixin') === 0
        ? ['browser_missing' as const] : []),
      ...(cloud.length === 0 || count((card) => card.source_platform === 'rss' || card.source_platform === 'aihot') === 0
        ? ['cloud_missing' as const] : []),
    ],
  };
  return { cards, summary, materialById: new Map(cards.map((card) => [card.material_id, card])) };
}
