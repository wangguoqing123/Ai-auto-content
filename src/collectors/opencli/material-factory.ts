import { createHash } from 'node:crypto';
import { unifiedMaterialSchema, type UnifiedMaterial } from '../../types.js';

type Engagement = UnifiedMaterial['engagement'];

export interface BrowserMaterialInput {
  sourcePlatform: UnifiedMaterial['source_platform'];
  sourceKind?: UnifiedMaterial['source_kind'];
  collector: string;
  queryId: string;
  queryText?: string;
  searchRank?: number | null;
  sourceItemId: string;
  identityAliases?: string[];
  sourceAccessStatus?: UnifiedMaterial['source_access_status'];
  authorName: string;
  authorFollowers?: number | null;
  title: string;
  excerpt: string;
  sourceUrl: string;
  canonicalUrl: string;
  contentPath?: string | null;
  contentDownloaded?: boolean;
  publishedAt: string | null;
  publishedAtQuality: UnifiedMaterial['published_at_quality'];
  collectedAt: string;
  engagement: Partial<Engagement>;
  usageMode: UnifiedMaterial['usage_mode'];
  viralConfidence: UnifiedMaterial['viral_confidence'];
  status?: UnifiedMaterial['status'];
  rejectionReasons?: string[];
}

const METRICS: Array<keyof Engagement> = ['views', 'likes', 'comments', 'shares', 'reposts', 'quotes', 'bookmarks', 'collects'];

export function createBrowserMaterial(input: BrowserMaterialInput): UnifiedMaterial {
  const engagement = Object.fromEntries(METRICS.map((key) => [key, input.engagement[key] ?? null])) as Engagement;
  const availableMetrics = METRICS.filter((key) => engagement[key] !== null).length;
  const sourceItemId = input.sourceItemId.trim();
  const identity = sourceItemId
    ? `${input.sourcePlatform}\nitem:${sourceItemId}`
    : `${input.sourcePlatform}\nurl:${input.canonicalUrl}`;
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 12);
  return unifiedMaterialSchema.parse({
    material_id: `mat_${hash}`,
    source_platform: input.sourcePlatform,
    source_kind: input.sourceKind ?? 'ugc',
    collector: input.collector,
    query_id: input.queryId,
    query_text: input.queryText ?? '',
    search_rank: input.searchRank ?? null,
    source_item_id: sourceItemId,
    identity_aliases: [...new Set(input.identityAliases ?? [])].filter(Boolean).sort(),
    source_access_status: input.sourceAccessStatus ?? 'resolved',
    author_name: input.authorName,
    author_followers: input.authorFollowers ?? null,
    title: input.title,
    excerpt: input.excerpt,
    source_url: input.sourceUrl,
    canonical_url: input.canonicalUrl,
    content_path: input.contentPath ?? null,
    content_downloaded: input.contentDownloaded ?? Boolean(input.contentPath),
    published_at: input.publishedAt,
    published_at_quality: input.publishedAtQuality,
    collected_at: input.collectedAt,
    engagement,
    metric_quality: availableMetrics === 0 ? 'unavailable' : availableMetrics === METRICS.length ? 'complete' : 'partial',
    usage_mode: input.usageMode,
    viral_confidence: input.viralConfidence,
    status: input.status ?? 'accepted',
    rejection_reasons: input.rejectionReasons ?? [],
  });
}
