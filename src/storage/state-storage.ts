import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { seenMaterialsSchema, type SeenMaterials } from '../types.js';

const EMPTY_STATE: SeenMaterials = {
  version: 1,
  url_fingerprints: [],
  content_fingerprints: [],
  updated_at: null,
};

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export class StateStorage {
  private readonly statePath: string;

  constructor(rootDir: string) {
    this.statePath = path.join(rootDir, 'data', 'state', 'seen-materials.json');
  }

  async load(): Promise<SeenMaterials> {
    try {
      return seenMaterialsSchema.parse(JSON.parse(await readFile(this.statePath, 'utf8')));
    } catch (error) {
      if (isMissingFile(error)) return structuredClone(EMPTY_STATE);
      throw error;
    }
  }

  async save(state: SeenMaterials): Promise<void> {
    const validated = seenMaterialsSchema.parse(state);
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.statePath);
  }
}
