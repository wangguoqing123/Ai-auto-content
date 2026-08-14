import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TopicHistoryEntry } from './history.js';
import type { TopicMaterialCard } from './schemas.js';

async function fileHash(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

export interface TopicInputHashOptions {
  rootDir: string;
  materials: TopicMaterialCard[];
  history: TopicHistoryEntry[];
  provider: string;
  model: string;
  promptVersion: string;
}

export async function computeTopicInputHash(options: TopicInputHashOptions): Promise<string> {
  const configFiles = [
    'config/product.yaml',
    'config/content-fit.yaml',
    'config/project.yaml',
    'config/topic-intelligence.yaml',
  ];
  const configHashes = Object.fromEntries(await Promise.all(configFiles.map(async (file) => [
    file,
    await fileHash(path.join(options.rootDir, file)),
  ])));
  const payload = {
    materials: options.materials
      .map((material) => ({
        material_id: material.material_id,
        role: material.role,
        engagement: material.engagement,
      }))
      .sort((left, right) => left.material_id.localeCompare(right.material_id)),
    topic_signatures: options.history.map(({ topicSignature }) => topicSignature).filter(Boolean).sort(),
    config_hashes: configHashes,
    provider: options.provider,
    model: options.model,
    prompt_version: options.promptVersion,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
