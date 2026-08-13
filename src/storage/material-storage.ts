import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { materialSchema, type Material } from '../types.js';

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export class MaterialStorage {
  constructor(private readonly rootDir: string) {}

  filePath(date: string): string {
    return path.join(this.rootDir, 'data', 'materials', `${date}.jsonl`);
  }

  async readDate(date: string): Promise<Material[]> {
    try {
      const contents = await readFile(this.filePath(date), 'utf8');
      return contents.split('\n').filter(Boolean).map((line) => materialSchema.parse(JSON.parse(line)));
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  async appendUnique(date: string, materials: Material[]): Promise<number> {
    if (materials.length === 0) return 0;
    const existing = await this.readDate(date);
    const seenUrls = new Set(existing.map((material) => material.fingerprint));
    const seenContent = new Set(existing.map((material) => material.content_fingerprint));
    const unique = materials
      .map((material) => materialSchema.parse(material))
      .filter((material) => !seenUrls.has(material.fingerprint) && !seenContent.has(material.content_fingerprint))
      .sort((left, right) => left.canonical_url.localeCompare(right.canonical_url)
        || left.source_id.localeCompare(right.source_id));

    if (unique.length === 0) return 0;
    await mkdir(path.dirname(this.filePath(date)), { recursive: true });
    await appendFile(this.filePath(date), `${unique.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
    return unique.length;
  }
}
