import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { contentFitProfileSchema, type ContentFitProfile } from './content-fit-profile.js';

export async function loadContentFitProfile(rootDir = process.cwd()): Promise<ContentFitProfile> {
  const filePath = path.join(rootDir, 'config', 'content-fit.yaml');
  try {
    const contents = await readFile(filePath, 'utf8');
    return contentFitProfileSchema.parse(parse(contents) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Content fit validation failed for config/content-fit.yaml: ${message}`, { cause: error });
  }
}
