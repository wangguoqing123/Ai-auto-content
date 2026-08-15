import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import {
  experimentTaskCatalogSchema,
  researchIntelligenceConfigSchema,
  type ExperimentTaskCatalog,
  type ResearchIntelligenceConfig,
} from './schemas.js';

async function readYaml(filePath: string): Promise<unknown> {
  return parse(await readFile(filePath, 'utf8')) as unknown;
}

export async function loadResearchIntelligenceConfig(rootDir = process.cwd()): Promise<ResearchIntelligenceConfig> {
  const filePath = path.join(rootDir, 'config', 'research-intelligence.yaml');
  try {
    return researchIntelligenceConfigSchema.parse(await readYaml(filePath));
  } catch (error) {
    throw new Error(`Research intelligence configuration invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export async function loadExperimentTaskCatalog(rootDir = process.cwd()): Promise<ExperimentTaskCatalog> {
  const filePath = path.join(rootDir, 'config', 'experiment-task-catalog.yaml');
  try {
    return experimentTaskCatalogSchema.parse(await readYaml(filePath));
  } catch (error) {
    throw new Error(`Experiment task catalog invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
