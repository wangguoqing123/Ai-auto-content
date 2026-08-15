import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TopicDecision } from '../topic-intelligence/schemas.js';
import type { ResearchSourceManifest } from './schemas.js';
import type { ResearchSourceMaterial } from './source-materials.js';

async function fileHash(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

export interface ResearchInputHashOptions {
  rootDir: string;
  topicDecision: TopicDecision;
  materials: ResearchSourceMaterial[];
  sources: Array<Pick<ResearchSourceManifest,
    'material_id' | 'content_sha256' | 'retrieval_method' | 'content_scope' | 'retrieval_url'
    | 'canonical_fetch_status' | 'canonical_http_status' | 'fetch_status'>>;
  provider: string;
  model: string;
  runtimeVersion: string | null;
  promptVersion: string;
}

export async function computeResearchInputHash(options: ResearchInputHashOptions): Promise<string> {
  const configFiles = [
    'config/research-intelligence.yaml',
    'config/sources.yaml',
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
    sources: options.materials.map(({ material, provenance }) => ({
      material_id: material.material_id,
      canonical_url: material.canonical_url,
      source_provenance: provenance,
      ...(() => {
        const source = options.sources.find((item) => item.material_id === material.material_id);
        return {
          fetch_status: source?.fetch_status ?? 'failed',
          retrieval_method: source?.retrieval_method ?? null,
          content_scope: source?.content_scope ?? null,
          retrieval_url: source?.retrieval_url ?? null,
          canonical_fetch_status: source?.canonical_fetch_status ?? 'not_attempted',
          canonical_http_status: source?.canonical_http_status ?? null,
          content_sha256: source?.content_sha256 ?? null,
        };
      })(),
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
