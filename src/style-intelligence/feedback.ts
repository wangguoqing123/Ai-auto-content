import { chmod, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureStyleCorpus } from './corpus.js';
import { sha256, stableJson } from './hash.js';
import type { ArticleType } from './schemas.js';

export interface StyleFeedbackEntry {
  feedback_id: string;
  before: string;
  after: string;
  accepted_changes: string[];
  rejected_changes: string[];
  reason_labels: string[];
  platform: string;
  article_type: ArticleType;
  timestamp: string;
}

export interface ProposedProfileDelta {
  status: 'proposal_only';
  minimum_consistent_edits_met: true;
  reason_labels: string[];
  occurrences: number;
  proposed_positive_rules: string[];
  proposed_anti_patterns: string[];
  requires_explicit_user_approval: true;
}

export async function recordStyleFeedback(corpusRoot: string, input: Omit<StyleFeedbackEntry, 'feedback_id'>): Promise<StyleFeedbackEntry> {
  await ensureStyleCorpus(corpusRoot);
  const feedbackId = `feedback_${sha256(stableJson(input)).slice(0, 16)}`;
  const entry = { feedback_id: feedbackId, ...input };
  const filename = path.join(corpusRoot, 'feedback', `${feedbackId}.json`);
  await writeFile(filename, `${JSON.stringify(entry, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(filename, 0o600);
  return entry;
}

export async function loadStyleFeedback(corpusRoot: string): Promise<StyleFeedbackEntry[]> {
  await ensureStyleCorpus(corpusRoot);
  const entries: StyleFeedbackEntry[] = [];
  for (const entry of await readdir(path.join(corpusRoot, 'feedback'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) entries.push(JSON.parse(await readFile(path.join(corpusRoot, 'feedback', entry.name), 'utf8')) as StyleFeedbackEntry);
  }
  return entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function proposeProfileDelta(entries: readonly StyleFeedbackEntry[]): ProposedProfileDelta | null {
  const groups = new Map<string, StyleFeedbackEntry[]>();
  for (const entry of entries) {
    const key = [...entry.reason_labels].sort().join('|');
    if (key !== '') groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const eligible = [...groups.entries()].filter(([, items]) => items.length >= 3).sort((left, right) => right[1].length - left[1].length)[0];
  if (eligible === undefined) return null;
  const [key, items] = eligible;
  return {
    status: 'proposal_only',
    minimum_consistent_edits_met: true,
    reason_labels: key.split('|'),
    occurrences: items.length,
    proposed_positive_rules: [...new Set(items.flatMap(({ accepted_changes }) => accepted_changes))].slice(0, 10),
    proposed_anti_patterns: [...new Set(items.flatMap(({ rejected_changes }) => rejected_changes))].slice(0, 10),
    requires_explicit_user_approval: true,
  };
}
