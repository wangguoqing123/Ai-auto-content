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

export type ExistingTopicDecisionResult =
  | { state: 'absent' }
  | { state: 'valid'; decision: TopicDecision }
  | { state: 'invalid'; errorCode: 'schema_invalid'; safeMessage: string };

export async function readExistingTopicDecision(rootDir: string, decisionDate: string): Promise<ExistingTopicDecisionResult> {
  try {
    const decision = topicDecisionSchema.parse(JSON.parse(await readFile(
      path.join(rootDir, 'data', 'topic-decisions', `${decisionDate}.json`),
      'utf8',
    )) as unknown);
    if (decision.decision_date !== decisionDate) {
      return { state: 'invalid', errorCode: 'schema_invalid', safeMessage: 'Existing daily decision has a mismatched decision date.' };
    }
    return { state: 'valid', decision };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
    return { state: 'invalid', errorCode: 'schema_invalid', safeMessage: 'Existing daily decision is unreadable or does not match the strict schema.' };
  }
}

export async function writeTopicOutputs(
  rootDir: string,
  decision: TopicDecision,
  materials: Map<string, TopicMaterialCard>,
): Promise<void> {
  const serialized = `${JSON.stringify(decision, null, 2)}\n`;
  const decisionPath = path.join(rootDir, 'data', 'topic-decisions', `${decision.decision_date}.json`);
  const runPath = path.join(rootDir, 'data', 'topic-runs', `${decision.run_id}.json`);
  const reportPath = path.join(rootDir, 'reports', 'topics', `${decision.decision_date}.md`);
  await Promise.all([decisionPath, runPath, reportPath].map((filePath) => mkdir(path.dirname(filePath), { recursive: true })));
  await Promise.all([
    atomicWrite(decisionPath, serialized),
    atomicWrite(runPath, serialized),
    atomicWrite(reportPath, renderTopicReport(decision, materials)),
  ]);
}
