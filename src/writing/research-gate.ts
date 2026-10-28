import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { researchPackSchema, type ResearchPack } from '../research/schemas.js';
import { buildSyntheticReadyResearchPack } from './fixture.js';

export type ResearchGateDecision = 'READY' | 'WAITING_FOR_RESEARCH' | 'NO_CONTENT' | 'BLOCKED_BY_RESEARCH';

export interface ResearchGateResult {
  gate_decision: ResearchGateDecision;
  writing_decision: 'WAITING_FOR_RESEARCH' | 'NO_CONTENT' | 'BLOCKED_BY_RESEARCH' | null;
  pack: ResearchPack | null;
  pack_path: string | null;
}

export interface EvaluateResearchGateOptions {
  rootDir: string;
  writingDate: string;
  syntheticReadyFixture?: boolean;
  read?: typeof readFile;
}

export async function evaluateResearchGate(options: EvaluateResearchGateOptions): Promise<ResearchGateResult> {
  if (options.syntheticReadyFixture === true) return { gate_decision: 'READY', writing_decision: null, pack: buildSyntheticReadyResearchPack(), pack_path: null };
  const filename = path.join(options.rootDir, 'data', 'research-packs', options.writingDate, 'research-pack.json');
  let raw: string;
  try { raw = await (options.read ?? readFile)(filename, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { gate_decision: 'WAITING_FOR_RESEARCH', writing_decision: 'WAITING_FOR_RESEARCH', pack: null, pack_path: null };
    throw error;
  }
  let pack: ResearchPack;
  try { pack = researchPackSchema.parse(JSON.parse(raw) as unknown); }
  catch { return { gate_decision: 'WAITING_FOR_RESEARCH', writing_decision: 'WAITING_FOR_RESEARCH', pack: null, pack_path: filename }; }
  if (pack.status === 'failed') return { gate_decision: 'WAITING_FOR_RESEARCH', writing_decision: 'WAITING_FOR_RESEARCH', pack, pack_path: filename };
  if (pack.decision === 'NO_TOPIC') return { gate_decision: 'NO_CONTENT', writing_decision: 'NO_CONTENT', pack, pack_path: filename };
  if (pack.decision === 'RESEARCH_INCOMPLETE') return { gate_decision: 'BLOCKED_BY_RESEARCH', writing_decision: 'BLOCKED_BY_RESEARCH', pack, pack_path: filename };
  return { gate_decision: 'READY', writing_decision: null, pack, pack_path: filename };
}
