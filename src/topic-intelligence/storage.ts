import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderTopicReport } from './report.js';
import { topicDecisionSchema, type TopicDecision, type TopicMaterialCard } from './schemas.js';

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, filePath);
}

export async function readExistingTopicDecision(rootDir: string, decisionDate: string): Promise<TopicDecision | null> {
  try {
    return topicDecisionSchema.parse(JSON.parse(await readFile(
      path.join(rootDir, 'data', 'topic-decisions', `${decisionDate}.json`),
      'utf8',
    )) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

export async function writeTopicOutputs(
  rootDir: string,
  decision: TopicDecision,
  materials: Map<string, TopicMaterialCard>,
): Promise<void> {
  const serialized = `${JSON.stringify(decision, null, 2)}\n`;
  await Promise.all([
    atomicWrite(path.join(rootDir, 'data', 'topic-decisions', `${decision.decision_date}.json`), serialized),
    atomicWrite(path.join(rootDir, 'data', 'topic-runs', `${decision.run_id}.json`), serialized),
    atomicWrite(path.join(rootDir, 'reports', 'topics', `${decision.decision_date}.md`), renderTopicReport(decision, materials)),
  ]);
}
