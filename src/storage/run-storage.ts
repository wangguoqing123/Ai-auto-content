import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runLogSchema, type RunLog } from '../types.js';

export class RunStorage {
  constructor(private readonly rootDir: string) {}

  async save(run: RunLog): Promise<string> {
    const validated = runLogSchema.parse(run);
    const filePath = path.join(this.rootDir, 'data', 'runs', `${validated.run_id}.json`);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    return filePath;
  }
}
