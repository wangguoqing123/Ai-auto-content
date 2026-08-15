import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ensureStyleCorpus, secureCorpusWrite } from './corpus.js';
import { sha256, stableJson } from './hash.js';
import { articleTypeSchema } from './schemas.js';

const nonEmpty = (maximum: number) => z.string().trim().min(1).max(maximum);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const styleFeedbackChangeSchema = z.strictObject({
  change_id: nonEmpty(200),
  direction: nonEmpty(100),
  description: nonEmpty(2_000),
  affected_rule_id: nonEmpty(300),
});

export const styleFeedbackEntrySchema = z.strictObject({
  feedback_id: z.string().regex(/^feedback_[a-f0-9]{16}$/),
  writing_pack_id: nonEmpty(300),
  writing_input_hash: sha256Schema,
  draft_hash: sha256Schema,
  profile_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,100}$/),
  profile_version: z.number().int().positive(),
  change_signature: sha256Schema,
  before: nonEmpty(2_000_000),
  after: nonEmpty(2_000_000),
  accepted_changes: z.array(styleFeedbackChangeSchema).max(30),
  rejected_changes: z.array(styleFeedbackChangeSchema).max(30),
  reason_labels: z.array(nonEmpty(200)).max(30),
  platform: nonEmpty(100),
  article_type: articleTypeSchema,
  cross_type: z.boolean(),
  timestamp: z.iso.datetime(),
}).superRefine((entry, context) => {
  if (entry.draft_hash !== sha256(entry.before)) context.addIssue({ code: 'custom', path: ['draft_hash'], message: 'draft_hash must hash the before draft' });
  if (entry.change_signature !== computeStyleChangeSignature([...entry.accepted_changes, ...entry.rejected_changes])) {
    context.addIssue({ code: 'custom', path: ['change_signature'], message: 'change_signature must describe the structured change, independent of acceptance' });
  }
  if (entry.accepted_changes.length + entry.rejected_changes.length === 0) context.addIssue({ code: 'custom', message: 'Feedback requires at least one structured change' });
});

export const proposedProfileDeltaSchema = z.strictObject({
  status: z.literal('proposal_only'),
  minimum_consistent_edits_met: z.literal(true),
  profile_id: z.string(),
  profile_version: z.number().int().positive(),
  change_signature: sha256Schema,
  reason_labels: z.array(z.string()),
  occurrences: z.number().int().min(3),
  platforms: z.array(z.string()).min(1),
  article_types: z.array(articleTypeSchema).min(1),
  cross_type: z.boolean(),
  proposed_positive_rules: z.array(z.string()).max(10),
  proposed_anti_patterns: z.array(z.string()).max(10),
  supporting_feedback_ids: z.array(z.string().regex(/^feedback_[a-f0-9]{16}$/)).min(3),
  conflict_count: z.literal(0),
  requires_explicit_user_approval: z.literal(true),
});

export type StyleFeedbackChange = z.infer<typeof styleFeedbackChangeSchema>;
export type StyleFeedbackEntry = z.infer<typeof styleFeedbackEntrySchema>;
export type ProposedProfileDelta = z.infer<typeof proposedProfileDeltaSchema>;

export function computeStyleChangeSignature(changes: readonly StyleFeedbackChange[]): string {
  const normalized = changes.map(({ direction, description, affected_rule_id }) => ({ direction, description, affected_rule_id }))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  return sha256(stableJson(normalized));
}

export async function recordStyleFeedback(corpusRoot: string, input: Omit<StyleFeedbackEntry, 'feedback_id'>): Promise<StyleFeedbackEntry> {
  await ensureStyleCorpus(corpusRoot);
  const feedbackId = `feedback_${sha256(stableJson(input)).slice(0, 16)}`;
  const entry = styleFeedbackEntrySchema.parse({ feedback_id: feedbackId, ...input });
  await secureCorpusWrite(path.join(corpusRoot, 'feedback', `${feedbackId}.json`), `${JSON.stringify(entry, null, 2)}\n`);
  return entry;
}

export async function loadStyleFeedback(corpusRoot: string): Promise<StyleFeedbackEntry[]> {
  await ensureStyleCorpus(corpusRoot);
  const entries: StyleFeedbackEntry[] = [];
  for (const entry of await readdir(path.join(corpusRoot, 'feedback'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) entries.push(styleFeedbackEntrySchema.parse(JSON.parse(await readFile(path.join(corpusRoot, 'feedback', entry.name), 'utf8'))));
  }
  return entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function proposeProfileDelta(entries: readonly StyleFeedbackEntry[]): ProposedProfileDelta | null {
  const parsed = entries.map((entry) => styleFeedbackEntrySchema.parse(entry));
  const groups = new Map<string, StyleFeedbackEntry[]>();
  for (const entry of parsed) {
    const key = `${entry.profile_id}\n${entry.profile_version}\n${entry.change_signature}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const candidates: ProposedProfileDelta[] = [];
  for (const items of groups.values()) {
    const accepted = items.filter(({ accepted_changes }) => accepted_changes.length > 0);
    const conflicts = items.filter(({ rejected_changes }) => rejected_changes.length > 0);
    if (conflicts.length > 0) continue;
    const uniquePacks = new Set(accepted.map(({ writing_pack_id }) => writing_pack_id));
    const uniqueDrafts = new Set(accepted.map(({ draft_hash }) => draft_hash));
    if (uniquePacks.size < 3 || uniqueDrafts.size < 3) continue;
    const platforms = [...new Set(accepted.map(({ platform }) => platform))];
    if (platforms.length !== 1) continue;
    const articleTypes = [...new Set(accepted.map(({ article_type }) => article_type))];
    const crossType = articleTypes.length > 1;
    if (crossType && !accepted.every(({ cross_type }) => cross_type)) continue;
    const supporting = accepted.filter((entry, index, all) => all.findIndex((other) => other.writing_pack_id === entry.writing_pack_id) === index)
      .filter((entry, index, all) => all.findIndex((other) => other.draft_hash === entry.draft_hash) === index);
    if (supporting.length < 3) continue;
    const changes = supporting.flatMap(({ accepted_changes }) => accepted_changes);
    candidates.push(proposedProfileDeltaSchema.parse({
      status: 'proposal_only',
      minimum_consistent_edits_met: true,
      profile_id: supporting[0]!.profile_id,
      profile_version: supporting[0]!.profile_version,
      change_signature: supporting[0]!.change_signature,
      reason_labels: [...new Set(supporting.flatMap(({ reason_labels }) => reason_labels))].sort(),
      occurrences: supporting.length,
      platforms,
      article_types: articleTypes,
      cross_type: crossType,
      proposed_positive_rules: [...new Set(changes.filter(({ direction }) => !/remove|reject|delete/iu.test(direction)).map(({ description }) => description))].slice(0, 10),
      proposed_anti_patterns: [...new Set(changes.filter(({ direction }) => /remove|reject|delete/iu.test(direction)).map(({ description }) => description))].slice(0, 10),
      supporting_feedback_ids: supporting.map(({ feedback_id }) => feedback_id),
      conflict_count: 0,
      requires_explicit_user_approval: true,
    }));
  }
  return candidates.sort((left, right) => right.occurrences - left.occurrences || left.change_signature.localeCompare(right.change_signature))[0] ?? null;
}
