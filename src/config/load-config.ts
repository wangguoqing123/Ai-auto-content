import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import {
  scoringConfigSchema,
  sourcesFileSchema,
  type ScoringConfig,
  type SourcesFile,
} from '../types.js';

async function readYaml(filePath: string): Promise<unknown> {
  const contents = await readFile(filePath, 'utf8');
  return parse(contents) as unknown;
}

export async function loadConfig(rootDir = process.cwd()): Promise<{
  sources: SourcesFile;
  scoring: ScoringConfig;
}> {
  const [sources, scoring] = await Promise.all([
    readYaml(path.join(rootDir, 'config', 'sources.yaml')),
    readYaml(path.join(rootDir, 'config', 'scoring.yaml')),
  ]);

  return {
    sources: sourcesFileSchema.parse(sources),
    scoring: scoringConfigSchema.parse(scoring),
  };
}
