import { createHash } from 'node:crypto';
import type { UnifiedMaterial } from '../types.js';
import { scanUntrustedMaterialText } from '../local-runtime/sensitive-content.js';
import { cleanedSourceSnapshotSchema, researchSourceManifestSchema, type CleanedSourceSnapshot, type ResearchIntelligenceConfig, type ResearchSourceManifest } from './schemas.js';
import { replayOfficialRssItem } from './official-rss-source.js';
import { fetchAndExtractMaterial, ResearchSourceFetchError, type SourceFetchOptions } from './source-fetcher.js';
import { sourceIdForMaterial, type ResearchSourceMaterial } from './source-materials.js';

export interface SourceAcquisition {
  material: ResearchSourceMaterial;
  snapshot: CleanedSourceSnapshot | null;
  manifest: ResearchSourceManifest;
}

export interface SourceAcquisitionOptions {
  fetchCanonical?: typeof fetchAndExtractMaterial;
  fetchOptions?: SourceFetchOptions;
  replayRss?: typeof replayOfficialRssItem;
  now?: () => Date;
}

function normalizePersisted(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function persistedExcerptHash(material: UnifiedMaterial, configuredSourceId: string): string {
  return createHash('sha256').update(JSON.stringify({
    title: normalizePersisted(material.title),
    excerpt: normalizePersisted(material.excerpt),
    published_at: material.published_at,
    source_id: configuredSourceId,
    canonical_url: material.canonical_url,
  })).digest('hex');
}

function isPersistedExcerptSafe(material: UnifiedMaterial): boolean {
  const text = `${material.title}\n${material.excerpt}`;
  return material.excerpt.trim() !== ''
    && scanUntrustedMaterialText(text).length === 0
    && !/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)\s*[:=]/i.test(text)
    && !/\/Users\/[^/\s]+|(?:^|\s)~\//.test(text);
}

function isOfficialPrimaryRss(source: ResearchSourceMaterial): boolean {
  return source.material.collector === 'rss'
    && source.material.source_kind === 'official'
    && source.provenance.source_type === 'rss'
    && source.provenance.source_tier === 'primary'
    && source.provenance.source_id !== null
    && source.provenance.source_config_url !== null;
}

function persistedExcerptSnapshot(
  source: ResearchSourceMaterial,
  input: { canonicalFetchStatus: 'blocked' | 'failed'; canonicalHttpStatus: number | null; fallbackReason: string; now: Date },
): CleanedSourceSnapshot {
  const material = source.material;
  return cleanedSourceSnapshotSchema.parse({
    source_id: sourceIdForMaterial(material.material_id),
    material_id: material.material_id,
    title: material.title,
    author: material.author_name,
    final_url: material.canonical_url,
    content_type: 'text/plain',
    content_sha256: persistedExcerptHash(material, source.provenance.source_id!),
    retrieved_at: input.now.toISOString(),
    retrieval_method: 'persisted_official_rss_excerpt',
    content_scope: 'feed_excerpt',
    retrieval_url: source.provenance.source_config_url,
    canonical_fetch_status: input.canonicalFetchStatus,
    canonical_http_status: input.canonicalHttpStatus,
    fallback_reason: input.fallbackReason,
    snapshot_collected_at: material.collected_at,
    segments: [
      { segment_id: 'p0001', heading: 'Official RSS item title', text: normalizePersisted(material.title) },
      { segment_id: 'p0002', heading: 'Official RSS item excerpt', text: normalizePersisted(material.excerpt) },
    ],
  });
}

function manifestFor(source: ResearchSourceMaterial, snapshot: CleanedSourceSnapshot | null, input: {
  canonicalFetchStatus: ResearchSourceManifest['canonical_fetch_status'];
  canonicalHttpStatus: number | null;
  fallbackReason: string | null;
  errorCode: string | null;
}): ResearchSourceManifest {
  const material = source.material;
  return researchSourceManifestSchema.parse({
    source_id: sourceIdForMaterial(material.material_id),
    material_id: material.material_id,
    canonical_url: material.canonical_url,
    final_url: snapshot?.final_url ?? null,
    title: snapshot?.title ?? material.title,
    author: snapshot?.author ?? material.author_name,
    retrieved_at: snapshot?.retrieved_at ?? null,
    content_type: snapshot?.content_type ?? '',
    content_sha256: snapshot?.content_sha256 ?? null,
    fetch_status: snapshot === null
      ? input.errorCode === 'unsupported_content_type' ? 'unsupported_content_type' : 'failed'
      : 'success',
    retrieval_method: snapshot?.retrieval_method ?? null,
    content_scope: snapshot?.content_scope ?? null,
    retrieval_url: snapshot?.retrieval_url ?? source.provenance.source_config_url,
    canonical_fetch_status: snapshot?.canonical_fetch_status ?? input.canonicalFetchStatus,
    canonical_http_status: snapshot?.canonical_http_status ?? input.canonicalHttpStatus,
    fallback_reason: snapshot?.fallback_reason ?? input.fallbackReason,
    snapshot_collected_at: snapshot?.snapshot_collected_at ?? null,
    selected_quotes: [],
    error_code: input.errorCode,
  });
}

export function acquiredSnapshot(source: ResearchSourceMaterial, snapshot: CleanedSourceSnapshot): SourceAcquisition {
  return {
    material: source,
    snapshot,
    manifest: manifestFor(source, snapshot, {
      canonicalFetchStatus: snapshot.canonical_fetch_status,
      canonicalHttpStatus: snapshot.canonical_http_status,
      fallbackReason: snapshot.fallback_reason,
      errorCode: null,
    }),
  };
}

export async function acquireResearchSource(
  source: ResearchSourceMaterial,
  config: ResearchIntelligenceConfig,
  options: SourceAcquisitionOptions = {},
): Promise<SourceAcquisition> {
  let canonicalFetchStatus: 'blocked' | 'failed' = 'failed';
  let canonicalHttpStatus: number | null = null;
  let fallbackReason = 'canonical_fetch_failed';
  try {
    const snapshot = await (options.fetchCanonical ?? fetchAndExtractMaterial)(source.material, config, options.fetchOptions);
    return { material: source, snapshot, manifest: manifestFor(source, snapshot, {
      canonicalFetchStatus: 'success', canonicalHttpStatus: 200, fallbackReason: null, errorCode: null,
    }) };
  } catch (error) {
    if (error instanceof ResearchSourceFetchError) {
      canonicalFetchStatus = error.code === 'canonical_access_blocked' ? 'blocked' : 'failed';
      canonicalHttpStatus = error.httpStatus;
      fallbackReason = error.code;
    } else {
      fallbackReason = error instanceof Error ? error.message.slice(0, 200) : 'canonical_fetch_failed';
    }
  }

  if (isOfficialPrimaryRss(source)) {
    try {
      const rssInput = {
        material: source.material,
        feedUrl: source.provenance.source_config_url!,
        config,
        canonicalFetchStatus,
        canonicalHttpStatus,
        fallbackReason,
        ...(options.fetchOptions === undefined ? {} : { fetchOptions: options.fetchOptions }),
      };
      const snapshot = await (options.replayRss ?? replayOfficialRssItem)(rssInput);
      if (snapshot !== null) return { material: source, snapshot, manifest: manifestFor(source, snapshot, {
        canonicalFetchStatus, canonicalHttpStatus, fallbackReason, errorCode: null,
      }) };
      fallbackReason = `${fallbackReason};rss_item_missing_or_empty`;
    } catch (error) {
      const code = error instanceof ResearchSourceFetchError ? error.code : 'rss_replay_failed';
      fallbackReason = `${fallbackReason};${code}`;
    }
    if (isPersistedExcerptSafe(source.material)) {
      const snapshot = persistedExcerptSnapshot(source, {
        canonicalFetchStatus,
        canonicalHttpStatus,
        fallbackReason,
        now: (options.now ?? (() => new Date()))(),
      });
      return { material: source, snapshot, manifest: manifestFor(source, snapshot, {
        canonicalFetchStatus, canonicalHttpStatus, fallbackReason, errorCode: null,
      }) };
    }
  }

  const unavailableError = fallbackReason === 'unsupported_content_type'
    ? 'unsupported_content_type' : 'source_unavailable';
  return { material: source, snapshot: null, manifest: manifestFor(source, null, {
    canonicalFetchStatus,
    canonicalHttpStatus,
    fallbackReason,
    errorCode: unavailableError,
  }) };
}

export async function acquireResearchSources(
  sources: ResearchSourceMaterial[],
  config: ResearchIntelligenceConfig,
  options: SourceAcquisitionOptions = {},
): Promise<SourceAcquisition[]> {
  const acquisitions: SourceAcquisition[] = [];
  for (const source of sources) acquisitions.push(await acquireResearchSource(source, config, options));
  return acquisitions;
}

export function withSelectedQuotes(
  acquisitions: SourceAcquisition[],
  claims: Array<{ claim_id: string; support_status: string; source_id: string | null; segment_id: string | null; quote: string }>,
): ResearchSourceManifest[] {
  return acquisitions.map(({ manifest }) => researchSourceManifestSchema.parse({
    ...manifest,
    selected_quotes: claims
      .filter((claim) => claim.support_status !== 'unsupported' && claim.source_id === manifest.source_id)
      .map((claim) => ({ claim_id: claim.claim_id, segment_id: claim.segment_id!, quote: claim.quote })),
  }));
}

export function sourceSummary(acquisitions: SourceAcquisition[]) {
  return {
    requested: acquisitions.length,
    fetched: acquisitions.filter(({ snapshot }) => snapshot !== null).length,
    failed: acquisitions.filter(({ manifest }) => manifest.fetch_status === 'failed').length,
    unsupported_content_type: acquisitions.filter(({ manifest }) => manifest.error_code === 'unsupported_content_type').length,
    canonical_success: acquisitions.filter(({ manifest }) => manifest.canonical_fetch_status === 'success').length,
    canonical_blocked: acquisitions.filter(({ manifest }) => manifest.canonical_fetch_status === 'blocked').length,
    rss_replay_success: acquisitions.filter(({ snapshot }) => snapshot?.retrieval_method === 'official_rss_replay').length,
    persisted_excerpt_used: acquisitions.filter(({ snapshot }) => snapshot?.retrieval_method === 'persisted_official_rss_excerpt').length,
    unavailable: acquisitions.filter(({ snapshot }) => snapshot === null).length,
  };
}
