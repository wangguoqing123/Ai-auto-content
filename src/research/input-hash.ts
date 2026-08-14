import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { UnifiedMaterial } from '../types.js';
import type { TopicDecision } from '../topic-intelligence/schemas.js';
import type { CleanedSourceSnapshot } from './schemas.js';

async function fileHash(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

export interface ResearchInputHashOptions {
  rootDir: string;
  topicDecision: TopicDecision;
  materials: UnifiedMaterial[];
  sources: Array<Pick<CleanedSourceSnapshot, 'material_id' | 'content_sha256'>>;
  provider: string;
  model: string;
  runtimeVersion: string | null;
  promptVersion: string;
}

export async function computeResearchInputHash(options: ResearchInputHashOptions): Promise<string> {
  const configFiles = [
    'config/research-intelligence.yaml',
    'config/experiment-task-catalog.yaml',
    'config/product.yaml',
    'config/content-fit.yaml',
  ];
  const configHashes = Object.fromEntries(await Promise.all(configFiles.map(async (file) => [
    file,
    await fileHash(path.join(options.rootDir, file)),
  ])));
  const topic = options.topicDecision.selected_topic;
  const payload = {
    topic_decision_input_hash: options.topicDecision.input_hash,
    topic_signature: topic?.topic_signature ?? null,
    selected_topic: topic,
    sources: options.materials.map((material) => ({
      material_id: material.material_id,
      canonical_url: material.canonical_url,
      content_sha256: options.sources.find((source) => source.material_id === material.material_id)?.content_sha256 ?? null,
    })),
    config_hashes: configHashes,
    provider: options.provider,
    model: options.model,
    runtime_version: options.runtimeVersion,
    prompt_version: options.promptVersion,
    research_pack_schema_version: 1,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function fallbackResearchInputHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
