import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { writingIntelligenceConfigSchema, type WritingIntelligenceConfig } from './schemas.js';

export async function loadWritingIntelligenceConfig(rootDir = process.cwd()): Promise<WritingIntelligenceConfig> {
  return writingIntelligenceConfigSchema.parse(YAML.parse(await readFile(path.join(rootDir, 'config', 'writing-intelligence.yaml'), 'utf8')));
}
