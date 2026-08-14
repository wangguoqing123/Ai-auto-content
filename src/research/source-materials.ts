import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { hasSensitiveWeixinAccessQuery } from '../collectors/opencli/weixin-article-artifact.js';
import { unifiedMaterialSchema, type UnifiedMaterial } from '../types.js';
import { classifyMaterialRole } from '../topic-intelligence/material-input.js';
import type { TopicDecision } from '../topic-intelligence/schemas.js';

export class ResearchSourceMaterialError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ResearchSourceMaterialError';
  }
}

async function filesIn(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(directory, entry.name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function sourceIdForMaterial(materialId: string): string {
  return `source_${materialId.replace(/^mat_/, '')}`;
}

function validPublicCanonicalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.username === '' && url.password === ''
      && !hasSensitiveWeixinAccessQuery(value);
  } catch {
    return false;
  }
}

export async function loadFactSourceMaterials(
  rootDir: string,
  decision: TopicDecision,
  maximumSources: number,
): Promise<UnifiedMaterial[]> {
  if (decision.status !== 'success' || decision.decision !== 'SELECT_TOPIC' || decision.selected_topic === null) {
    throw new ResearchSourceMaterialError('topic_input_invalid', 'A successful SELECT_TOPIC decision is required.');
  }
  const requested = decision.selected_topic.fact_source_ids;
  if (requested.length === 0 || requested.length > maximumSources) {
    throw new ResearchSourceMaterialError('source_material_invalid', 'Topic fact source count is outside the configured limit.');
  }
  const filePaths = [
    ...await filesIn(path.join(rootDir, 'data', 'materials')),
    ...await filesIn(path.join(rootDir, 'data', 'browser-materials')),
  ];
  const byId = new Map<string, UnifiedMaterial>();
  for (const filePath of filePaths) {
    for (const line of (await readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean)) {
      let parsed;
      try {
        parsed = unifiedMaterialSchema.safeParse(JSON.parse(line) as unknown);
      } catch {
        continue;
      }
      if (!parsed.success || !requested.includes(parsed.data.material_id)) continue;
      const previous = byId.get(parsed.data.material_id);
      if (previous === undefined || parsed.data.collected_at > previous.collected_at) byId.set(parsed.data.material_id, parsed.data);
    }
  }
  return requested.map((materialId) => {
    const material = byId.get(materialId);
    if (material === undefined) throw new ResearchSourceMaterialError('source_material_invalid', `Fact source material is missing: ${materialId}`);
    if (classifyMaterialRole(material) !== 'fact_source'
      || material.status !== 'accepted'
      || material.source_access_status !== 'resolved'
      || material.source_platform === 'xiaohongshu'
      || !validPublicCanonicalUrl(material.canonical_url)) {
      throw new ResearchSourceMaterialError('source_material_invalid', `Fact source material is not eligible for research: ${materialId}`);
    }
    return material;
  });
}
