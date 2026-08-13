import { engagementSchema, unifiedMaterialSchema, type UnifiedMaterial } from '../../types.js';

const METRICS = ['views', 'likes', 'comments', 'shares', 'reposts', 'quotes', 'bookmarks', 'collects'] as const;
const QUALITY_RANK: Record<UnifiedMaterial['published_at_quality'], number> = { unknown: 0, inferred: 1, exact: 2 };

function stableValues(value: string, separator: ',' | '；'): string[] {
  return [...new Set(value.split(separator).map((entry) => entry.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function combineValues(left: string, right: string, separator: ',' | '；'): string {
  return [...new Set([...stableValues(left, separator), ...stableValues(right, separator)])]
    .sort((first, second) => first.localeCompare(second))
    .join(separator);
}

function moreComplete(left: string, right: string): string {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (normalizedRight.length > normalizedLeft.length) return right;
  return left;
}

function maximumNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function canonicalUrl(left: string, right: string): string {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    const leftIsWeixinArticle = leftUrl.hostname === 'mp.weixin.qq.com';
    const rightIsWeixinArticle = rightUrl.hostname === 'mp.weixin.qq.com';
    if (leftIsWeixinArticle !== rightIsWeixinArticle) return rightIsWeixinArticle ? right : left;
    if (leftUrl.searchParams.size !== rightUrl.searchParams.size) {
      return leftUrl.searchParams.size < rightUrl.searchParams.size ? left : right;
    }
    if (leftUrl.pathname.length !== rightUrl.pathname.length) {
      return leftUrl.pathname.length > rightUrl.pathname.length ? left : right;
    }
    return left.localeCompare(right) <= 0 ? left : right;
  } catch {
    return left.length <= right.length ? left : right;
  }
}

function metricQuality(engagement: UnifiedMaterial['engagement']): UnifiedMaterial['metric_quality'] {
  const available = METRICS.filter((key) => engagement[key] !== null).length;
  return available === 0 ? 'unavailable' : available === METRICS.length ? 'complete' : 'partial';
}

function richness(material: UnifiedMaterial): number {
  return METRICS.filter((key) => material.engagement[key] !== null).length
    + (material.author_followers === null ? 0 : 2)
    + (material.content_downloaded ? 3 : 0)
    + Math.min(3, Math.floor(material.excerpt.length / 300));
}

export function mergeUnifiedMaterial(existing: UnifiedMaterial, incoming: UnifiedMaterial): UnifiedMaterial {
  const left = unifiedMaterialSchema.parse(existing);
  const right = unifiedMaterialSchema.parse(incoming);
  if (left.material_id !== right.material_id) throw new Error('Cannot merge materials with different material_id values');
  const incomingIsNewer = Date.parse(right.collected_at) >= Date.parse(left.collected_at);
  const preferred = richness(right) > richness(left) || (richness(right) === richness(left) && incomingIsNewer) ? right : left;
  const published = QUALITY_RANK[right.published_at_quality] > QUALITY_RANK[left.published_at_quality]
    ? right
    : QUALITY_RANK[right.published_at_quality] < QUALITY_RANK[left.published_at_quality]
      ? left
      : incomingIsNewer && right.published_at ? right : left;
  const engagement = engagementSchema.parse(Object.fromEntries(
    METRICS.map((key) => [key, maximumNullable(left.engagement[key], right.engagement[key])]),
  ));
  const sourceAccessStatus: UnifiedMaterial['source_access_status'] = left.source_access_status === 'resolved'
    || right.source_access_status === 'resolved' ? 'resolved' : 'unresolved';
  const rejectionReasons = [...new Set([...left.rejection_reasons, ...right.rejection_reasons])]
    .filter((reason) => sourceAccessStatus === 'unresolved' || reason !== 'unresolved_source_url')
    .sort();
  const status: UnifiedMaterial['status'] = sourceAccessStatus === 'unresolved'
    ? 'quarantined'
    : left.status === 'accepted' || right.status === 'accepted' ? 'accepted'
      : left.status === 'quarantined' || right.status === 'quarantined' ? 'quarantined' : 'rejected';

  return unifiedMaterialSchema.parse({
    ...preferred,
    query_id: combineValues(left.query_id, right.query_id, ','),
    query_text: combineValues(left.query_text, right.query_text, '；'),
    search_rank: left.search_rank === null ? right.search_rank
      : right.search_rank === null ? left.search_rank
        : Math.min(left.search_rank, right.search_rank),
    source_item_id: moreComplete(left.source_item_id, right.source_item_id),
    identity_aliases: [...new Set([...left.identity_aliases, ...right.identity_aliases])].sort(),
    source_access_status: sourceAccessStatus,
    author_name: moreComplete(left.author_name, right.author_name),
    author_followers: maximumNullable(left.author_followers, right.author_followers),
    title: moreComplete(left.title, right.title),
    excerpt: moreComplete(left.excerpt, right.excerpt),
    source_url: canonicalUrl(left.source_url, right.source_url),
    canonical_url: canonicalUrl(left.canonical_url, right.canonical_url),
    content_path: incomingIsNewer ? right.content_path ?? left.content_path : left.content_path ?? right.content_path,
    content_downloaded: left.content_downloaded || right.content_downloaded,
    published_at: published.published_at,
    published_at_quality: published.published_at_quality,
    collected_at: incomingIsNewer ? right.collected_at : left.collected_at,
    engagement,
    metric_quality: metricQuality(engagement),
    status,
    rejection_reasons: rejectionReasons,
  });
}

export function deduplicateUnifiedMaterials(materials: readonly UnifiedMaterial[]): UnifiedMaterial[] {
  const byId = new Map<string, UnifiedMaterial>();
  for (const candidate of materials) {
    const material = unifiedMaterialSchema.parse(candidate);
    const existing = byId.get(material.material_id);
    byId.set(material.material_id, existing ? mergeUnifiedMaterial(existing, material) : material);
  }
  return [...byId.values()].sort((left, right) => left.material_id.localeCompare(right.material_id));
}
