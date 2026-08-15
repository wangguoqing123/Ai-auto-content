import { createHash } from 'node:crypto';
import { cleanedSourceSnapshotSchema, type CleanedSourceSnapshot } from './schemas.js';
import { sourceIdForMaterial, type ResearchSourceMaterial } from './source-materials.js';

export function buildFixtureResearchSources(materials: ResearchSourceMaterial[]): CleanedSourceSnapshot[] {
  return materials.map((source) => {
    const material = source.material;
    const segments = [
      { segment_id: 'p0001', heading: 'Official RSS item title', text: material.title },
      { segment_id: 'p0002', heading: 'Official RSS item excerpt', text: material.excerpt },
    ];
    return cleanedSourceSnapshotSchema.parse({
      source_id: sourceIdForMaterial(material.material_id),
      material_id: material.material_id,
      title: material.title,
      author: material.author_name,
      final_url: material.canonical_url,
      content_type: 'text/plain',
      content_sha256: createHash('sha256').update(JSON.stringify(segments)).digest('hex'),
      retrieved_at: '2026-08-14T05:30:00.000Z',
      retrieval_method: 'persisted_official_rss_excerpt',
      content_scope: 'feed_excerpt',
      retrieval_url: source.provenance.source_config_url,
      canonical_fetch_status: 'blocked',
      canonical_http_status: 403,
      fallback_reason: 'canonical_access_blocked;fixture_rss_replay_unavailable',
      snapshot_collected_at: material.collected_at,
      segments,
    });
  });
}
