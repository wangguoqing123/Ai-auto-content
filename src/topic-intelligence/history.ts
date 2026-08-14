import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { topicDecisionSchema, type TopicCandidateProposal, type TopicDecision } from './schemas.js';

export interface TopicHistoryEntry {
  decisionDate: string;
  topicSignature: string;
  workingTitle: string;
  userProblem: string;
  minimumResult: string;
  coreAngle: string;
  contentPillar: string;
  evidenceRefs: string[];
}

export function normalizeTopicText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}

export function topicTokens(value: string): Set<string> {
  const normalized = normalizeTopicText(value);
  const tokens = new Set(normalized.match(/[a-z0-9]+|[\p{Script=Han}]/gu) ?? []);
  const compactHan = [...normalized.matchAll(/[\p{Script=Han}]+/gu)].map(([text]) => text).join('');
  for (let index = 0; index < compactHan.length - 1; index += 1) {
    tokens.add(compactHan.slice(index, index + 2));
  }
  return tokens;
}

export function tokenJaccard(left: string, right: string): number {
  const leftTokens = topicTokens(left);
  const rightTokens = topicTokens(right);
  if (leftTokens.size === 0 && rightTokens.size === 0) return 1;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

export function computeTopicSignature(candidate: Pick<TopicCandidateProposal,
  'learner_stage' | 'user_problem' | 'real_task' | 'minimum_result' | 'core_angle'>): string {
  const fields = [
    candidate.learner_stage,
    candidate.user_problem,
    candidate.real_task,
    candidate.minimum_result,
    candidate.core_angle,
  ].map(normalizeTopicText);
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

async function filesIfPresent(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function decisionToHistory(decision: TopicDecision): TopicHistoryEntry | null {
  const selected = decision.selected_topic;
  if (decision.status !== 'success' || decision.decision !== 'SELECT_TOPIC' || selected === null) return null;
  return {
    decisionDate: decision.decision_date,
    topicSignature: selected.topic_signature,
    workingTitle: selected.working_title,
    userProblem: selected.user_problem,
    minimumResult: selected.minimum_result,
    coreAngle: selected.core_angle,
    contentPillar: selected.content_pillar,
    evidenceRefs: [
      ...selected.fact_source_ids.map((id) => `material:${id}`),
      ...selected.new_evidence_refs,
    ],
  };
}

export async function loadTopicHistory(rootDir: string, decisionDate: string, windowDays: number): Promise<TopicHistoryEntry[]> {
  const cutoff = new Date(`${decisionDate}T00:00:00+08:00`);
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const entries: TopicHistoryEntry[] = [];
  for (const filePath of await filesIfPresent(path.join(rootDir, 'data', 'topic-decisions'))) {
    if (path.basename(filePath) === `${decisionDate}.json`) continue;
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    const decision = topicDecisionSchema.parse(raw);
    const date = new Date(`${decision.decision_date}T00:00:00+08:00`);
    if (Number.isNaN(date.getTime()) || date < cutoff || decision.decision_date >= decisionDate) continue;
    const item = decisionToHistory(decision);
    if (item !== null) entries.push(item);
  }
  for (const filePath of await filesIfPresent(path.join(rootDir, 'data', 'published'))) {
    const lines = (await readFile(filePath, 'utf8')).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        const dateText = String(value.published_at ?? value.decision_date ?? '');
        const date = new Date(dateText);
        if (Number.isNaN(date.getTime()) || date < cutoff) continue;
        entries.push({
          decisionDate: date.toISOString().slice(0, 10),
          topicSignature: String(value.topic_signature ?? ''),
          workingTitle: String(value.working_title ?? value.title ?? ''),
          userProblem: String(value.user_problem ?? ''),
          minimumResult: String(value.minimum_result ?? ''),
          coreAngle: String(value.core_angle ?? ''),
          contentPillar: String(value.content_pillar ?? ''),
          evidenceRefs: Array.isArray(value.evidence_refs)
            ? value.evidence_refs.map(String)
            : Array.isArray(value.evidence_ids) ? value.evidence_ids.map((id) => `material:${String(id)}`) : [],
        });
      } catch {
        continue;
      }
    }
  }
  return entries;
}

export interface DuplicateCheck {
  duplicate: boolean;
  reason: string | null;
  matchedEntry: TopicHistoryEntry | null;
}

export function checkRecentDuplicate(
  candidate: TopicCandidateProposal,
  signature: string,
  exactHistory: TopicHistoryEntry[],
  similarityHistory: TopicHistoryEntry[],
  threshold: number,
  validatedNewEvidenceRefs: string[] = [],
): DuplicateCheck {
  const normalizedNovelty = normalizeTopicText(candidate.novelty_delta);
  const meaningfulNovelty = normalizedNovelty.length >= 12
    && !/^(?:角度不同|内容更新|有新证据|different angle|content updated|new evidence)$/i.test(normalizedNovelty);
  const canBypass = (entry: TopicHistoryEntry): boolean => meaningfulNovelty
    && validatedNewEvidenceRefs.some((reference) => !entry.evidenceRefs.includes(reference));
  for (const entry of exactHistory) {
    const exact = entry.topicSignature !== '' && entry.topicSignature === signature;
    if (!exact) continue;
    if (canBypass(entry)) continue;
    return { duplicate: true, reason: 'duplicate_exact_signature', matchedEntry: entry };
  }
  for (const entry of similarityHistory) {
    const title = tokenJaccard(candidate.working_title, entry.workingTitle) >= threshold;
    const userProblem = tokenJaccard(candidate.user_problem, entry.userProblem) >= threshold;
    const minimumResult = tokenJaccard(candidate.minimum_result, entry.minimumResult) >= threshold;
    const coreAngle = tokenJaccard(candidate.core_angle, entry.coreAngle) >= threshold;
    const semanticDuplicate = (userProblem && minimumResult) || (userProblem && coreAngle) || (minimumResult && coreAngle);
    if (!title && !semanticDuplicate) continue;
    if (canBypass(entry)) continue;
    return {
      duplicate: true,
      reason: title ? 'duplicate_working_title' : 'duplicate_semantic_topic',
      matchedEntry: entry,
    };
  }
  return { duplicate: false, reason: null, matchedEntry: null };
}
