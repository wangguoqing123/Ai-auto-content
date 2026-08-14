import { createHash } from 'node:crypto';
import type { UnifiedMaterial } from '../types.js';
import { cleanedSourceSnapshotSchema, type CleanedSourceSnapshot } from './schemas.js';
import { sourceIdForMaterial } from './source-materials.js';

const fixtureTexts = [
  'The official report describes a shift from AI assistance to multi-step execution under explicit human oversight.',
  'The RingCentral case describes organizing engineering and operational information into owned actions with checkable completion conditions.',
];

export function buildFixtureResearchSources(materials: UnifiedMaterial[]): CleanedSourceSnapshot[] {
  return materials.map((material, index) => {
    const text = fixtureTexts[index] ?? `Fixture evidence for ${material.material_id}.`;
    const segments = [{ segment_id: 'p0001', heading: material.title, text }];
    return cleanedSourceSnapshotSchema.parse({
      source_id: sourceIdForMaterial(material.material_id),
      material_id: material.material_id,
      title: material.title,
      author: material.author_name,
      final_url: material.canonical_url,
      content_type: 'text/plain',
      content_sha256: createHash('sha256').update(JSON.stringify(segments)).digest('hex'),
      retrieved_at: '2026-08-14T05:30:00.000Z',
      segments,
    });
  });
}
