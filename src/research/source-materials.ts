import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { hasSensitiveWeixinAccessQuery } from '../collectors/opencli/weixin-article-artifact.js';
import {
  materialSchema,
  sourcesFileSchema,
  unifiedMaterialSchema,
  type UnifiedMaterial,
} from '../types.js';
import { classifyMaterialRole } from '../topic-intelligence/material-input.js';
import type { TopicDecision } from '../topic-intelligence/schemas.js';

export class ResearchSourceMaterialError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ResearchSourceMaterialError';
  }
}

export interface ResearchSourceMaterial {
  material: UnifiedMaterial;
  provenance: {
    source_id: string | null;
    source_name: string | null;
    source_type: 'rss' | 'api' | 'opencli' | null;
    source_tier: 'primary' | 'secondary' | 'unverified' | null;
    source_config_url: string | null;
  };
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
): Promise<ResearchSourceMaterial[]> {
  if (decision.status !== 'success' || decision.decision !== 'SELECT_TOPIC' || decision.selected_topic === null) {
    throw new ResearchSourceMaterialError('topic_input_invalid', 'A successful SELECT_TOPIC decision is required.');
  }
  const requested = decision.selected_topic.fact_source_ids;
  if (requested.length === 0 || requested.length > maximumSources) {
    throw new ResearchSourceMaterialError('source_material_invalid', 'Topic fact source count is outside the configured limit.');
  }
  const sourceConfig = sourcesFileSchema.parse(parse(await readFile(path.join(rootDir, 'config', 'sources.yaml'), 'utf8')) as unknown);
  const cloudFiles = await filesIn(path.join(rootDir, 'data', 'materials'));
  const browserFiles = await filesIn(path.join(rootDir, 'data', 'browser-materials'));
  const byId = new Map<string, ResearchSourceMaterial>();
  for (const filePath of [...cloudFiles, ...browserFiles]) {
    const cloud = cloudFiles.includes(filePath);
    for (const line of (await readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean)) {
      let parsed;
      try {
        parsed = (cloud ? materialSchema : unifiedMaterialSchema).safeParse(JSON.parse(line) as unknown);
      } catch {
        continue;
      }
      if (!parsed.success || !requested.includes(parsed.data.material_id)) continue;
      const material = unifiedMaterialSchema.parse(parsed.data);
      const complete = cloud ? materialSchema.parse(parsed.data) : null;
      const configured = complete === null ? undefined : sourceConfig.sources.find(({ id }) => id === complete.source_id);
      const configurationMatches = configured !== undefined
        && configured.enabled
        && configured.type === 'rss'
        && complete?.source_type === configured.type
        && complete.source_tier === configured.source_tier;
      const previous = byId.get(material.material_id);
      const parsedProvenance: ResearchSourceMaterial['provenance'] = complete === null
        ? {
          source_id: null, source_name: null, source_type: null, source_tier: null, source_config_url: null,
        }
        : {
          source_id: complete?.source_id ?? null,
          source_name: complete?.source_name ?? null,
          source_type: complete?.source_type ?? null,
          source_tier: complete?.source_tier ?? null,
          source_config_url: configurationMatches ? configured.url : null,
        };
      const previousHasCloudProvenance = previous?.provenance.source_id !== null && previous?.provenance.source_id !== undefined;
      if (previous === undefined
        || (complete !== null && (!previousHasCloudProvenance || material.collected_at > previous.material.collected_at))
        || (complete === null && !previousHasCloudProvenance && material.collected_at > previous.material.collected_at)) {
        byId.set(material.material_id, { material, provenance: parsedProvenance });
      }
    }
  }
  return requested.map((materialId) => {
    const source = byId.get(materialId);
    if (source === undefined) throw new ResearchSourceMaterialError('source_material_invalid', `Fact source material is missing: ${materialId}`);
    const { material } = source;
    if (classifyMaterialRole(material) !== 'fact_source'
      || material.status !== 'accepted'
      || material.source_access_status !== 'resolved'
      || material.source_platform === 'xiaohongshu'
      || !validPublicCanonicalUrl(material.canonical_url)) {
      throw new ResearchSourceMaterialError('source_material_invalid', `Fact source material is not eligible for research: ${materialId}`);
    }
    return source;
  });
}
