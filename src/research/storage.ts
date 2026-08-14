import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderResearchReport } from './report.js';
import { researchPackSchema, type ResearchPack } from './schemas.js';

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, filePath);
}

export type ExistingResearchPackResult =
  | { state: 'absent' }
  | { state: 'valid'; pack: ResearchPack }
  | { state: 'invalid'; safeMessage: string };

export async function readExistingResearchPack(rootDir: string, date: string): Promise<ExistingResearchPackResult> {
  try {
    const pack = researchPackSchema.parse(JSON.parse(await readFile(
      path.join(rootDir, 'data', 'research-packs', date, 'research-pack.json'),
      'utf8',
    )) as unknown);
    if (pack.research_date !== date) return { state: 'invalid', safeMessage: 'Existing Research Pack date does not match its path.' };
    return { state: 'valid', pack };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
    return { state: 'invalid', safeMessage: 'Existing Research Pack is unreadable or violates the strict schema.' };
  }
}

export async function writeResearchOutputs(rootDir: string, pack: ResearchPack): Promise<void> {
  const base = path.join(rootDir, 'data', 'research-packs', pack.research_date);
  const writes: Array<Promise<void>> = [
    atomicWrite(path.join(base, 'research-pack.json'), `${JSON.stringify(pack, null, 2)}\n`),
    atomicWrite(path.join(rootDir, 'data', 'research-runs', `${pack.run_id}.json`), `${JSON.stringify(pack, null, 2)}\n`),
    atomicWrite(path.join(rootDir, 'reports', 'research', `${pack.research_date}.md`), renderResearchReport(pack)),
  ];
  for (const source of pack.sources) {
    writes.push(atomicWrite(
      path.join(base, 'source-manifests', `${source.source_id}.json`),
      `${JSON.stringify(source, null, 2)}\n`,
    ));
  }
  if (pack.experiment !== null) {
    writes.push(atomicWrite(
      path.join(base, 'experiments', 'experiment-spec.json'),
      `${JSON.stringify(pack.experiment.spec, null, 2)}\n`,
    ));
    for (const result of pack.experiment.results) {
      writes.push(atomicWrite(
        path.join(base, 'experiments', `${result.variant_id}.json`),
        `${JSON.stringify(result, null, 2)}\n`,
      ));
    }
  }
  await Promise.all(writes);
}
