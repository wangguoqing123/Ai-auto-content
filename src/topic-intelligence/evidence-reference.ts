import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { evidenceReferenceSchema, type TopicMaterialCard } from './schemas.js';

export type EvidenceReferenceKind = 'material' | 'experiment' | 'project' | 'case';

export interface ParsedEvidenceReference {
  kind: EvidenceReferenceKind;
  id: string;
}

export interface EvidenceResolutionContext {
  rootDir: string;
  materials: Map<string, TopicMaterialCard>;
  requireFactMaterial?: boolean;
}

const evidenceDirectories: Record<Exclude<EvidenceReferenceKind, 'material'>, string> = {
  experiment: 'experiments',
  project: 'projects',
  case: 'cases',
};

const evidenceIdFields: Record<Exclude<EvidenceReferenceKind, 'material'>, string> = {
  experiment: 'experiment_id',
  project: 'project_id',
  case: 'case_id',
};

export function parseEvidenceReference(reference: string): ParsedEvidenceReference | null {
  if (!evidenceReferenceSchema.safeParse(reference).success) return null;
  const separator = reference.indexOf(':');
  return {
    kind: reference.slice(0, separator) as EvidenceReferenceKind,
    id: reference.slice(separator + 1),
  };
}

async function validEvidenceFileExists(
  directory: string,
  idField: string,
  expectedId: string,
): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await validEvidenceFileExists(filePath, idField, expectedId)) return true;
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        && (parsed as Record<string, unknown>)[idField] === expectedId) return true;
    } catch {
      // Invalid JSON is never evidence.
    }
  }
  return false;
}

export async function resolveEvidenceReference(
  reference: string,
  context: EvidenceResolutionContext,
): Promise<boolean> {
  const parsed = parseEvidenceReference(reference);
  if (parsed === null) return false;
  if (parsed.kind === 'material') {
    const material = context.materials.get(parsed.id);
    return material !== undefined && (!context.requireFactMaterial || material.role === 'fact_source');
  }
  return validEvidenceFileExists(
    path.join(context.rootDir, 'data', 'evidence', evidenceDirectories[parsed.kind]),
    evidenceIdFields[parsed.kind],
    parsed.id,
  );
}

export async function resolveEvidenceReferences(
  references: string[],
  context: EvidenceResolutionContext,
): Promise<{ valid: string[]; invalid: string[] }> {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const reference of references) {
    if (await resolveEvidenceReference(reference, context)) valid.push(reference);
    else invalid.push(reference);
  }
  return { valid, invalid };
}

export const validateEvidenceReferences = resolveEvidenceReferences;
