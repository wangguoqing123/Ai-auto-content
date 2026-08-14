import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { topicIntelligenceConfigSchema, type TopicIntelligenceConfig } from './schemas.js';

export async function loadTopicIntelligenceConfig(rootDir = process.cwd()): Promise<TopicIntelligenceConfig> {
  const filePath = path.join(rootDir, 'config', 'topic-intelligence.yaml');
  try {
    return topicIntelligenceConfigSchema.parse(parse(await readFile(filePath, 'utf8')) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Topic intelligence configuration invalid: ${message}`, { cause: error });
  }
}
