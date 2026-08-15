import path from 'node:path';
import { z } from 'zod';
import { ensureStyleCorpus, secureCorpusWrite } from './corpus.js';
import { computeStyleCorpusHash, sha256, stableJson } from './hash.js';
import { readPrivateCorpusFile } from './safe-local-path.js';
import type { CorpusDocument } from './types.js';

export const protectedKindSchema = z.enum(['signature_phrase', 'unique_metaphor', 'personal_experience_entity', 'distinctive_short_fragment']);

export const protectedTransferCandidateSchema = z.strictObject({
  kind: protectedKindSchema,
  text: z.string().trim().min(1).max(500),
  source_document_ids: z.array(z.string().regex(/^doc_[a-f0-9]{16}$/)).max(30),
  extraction_reason: z.string().trim().min(1).max(250),
});

export const protectedTransferEntrySchema = z.strictObject({
  entry_id: z.string().regex(/^protected_[a-f0-9]{16}$/),
  kind: protectedKindSchema,
  text: z.string().trim().min(1).max(500),
  normalized_text: z.string().trim().min(1).max(500),
  source_document_ids: z.array(z.string().regex(/^doc_[a-f0-9]{16}$/)).min(1),
  extraction_method: z.string().trim().min(1).max(300),
  exact_source_substring: z.literal(true),
}).superRefine((entry, context) => {
  const chineseCharacters = entry.text.match(/\p{Script=Han}/gu)?.length ?? 0;
  if (entry.kind === 'signature_phrase' && chineseCharacters < 4) {
    context.addIssue({ code: 'custom', path: ['text'], message: 'Signature phrases require at least four Chinese characters' });
  }
});

export const protectedTransferIndexSchema = z.strictObject({
  profile_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,100}$/),
  corpus_hash: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.iso.datetime(),
  entries: z.array(protectedTransferEntrySchema).max(500),
});

export type ProtectedTransferCandidate = z.infer<typeof protectedTransferCandidateSchema>;
export type ProtectedTransferEntry = z.infer<typeof protectedTransferEntrySchema>;
export type ProtectedTransferIndex = z.infer<typeof protectedTransferIndexSchema>;

function normalize(value: string): string { return value.normalize('NFKC').replace(/\s+/gu, ''); }

export function buildProtectedTransferIndex(
  documents: readonly CorpusDocument[],
  candidates: readonly ProtectedTransferCandidate[],
  createdAt = new Date().toISOString(),
): ProtectedTransferIndex {
  const sortedDocuments = [...documents].sort((left, right) => left.document_id.localeCompare(right.document_id));
  const first = sortedDocuments[0];
  if (first === undefined) throw new Error('protected_index_requires_documents');
  if (sortedDocuments.some((document) => document.profile_id !== first.profile_id || document.profile_type !== 'reference_technique' || document.rights_status !== 'public_reference')) {
    throw new Error('protected_index_requires_single_public_reference_profile');
  }
  const deduplicated = new Map<string, ProtectedTransferCandidate>();
  const knownDocumentIds = new Set(sortedDocuments.map(({ document_id }) => document_id));
  for (const candidateInput of candidates) {
    const candidate = protectedTransferCandidateSchema.parse(candidateInput);
    if (candidate.source_document_ids.some((documentId) => !knownDocumentIds.has(documentId))) throw new Error('protected_candidate_source_missing');
    const key = `${candidate.kind}\n${normalize(candidate.text)}`;
    if (!deduplicated.has(key)) deduplicated.set(key, candidate);
  }
  const entries = [...deduplicated.values()].map((candidate) => {
    const actualSources = sortedDocuments.filter(({ text }) => text.includes(candidate.text)).map(({ document_id }) => document_id);
    if (actualSources.length === 0) throw new Error(`protected_candidate_not_exact_source_substring:${candidate.kind}`);
    return protectedTransferEntrySchema.parse({
      entry_id: `protected_${sha256(stableJson({ profile_id: first.profile_id, kind: candidate.kind, text: candidate.text })).slice(0, 16)}`,
      kind: candidate.kind,
      text: candidate.text,
      normalized_text: normalize(candidate.text),
      source_document_ids: actualSources,
      extraction_method: `provider_candidate:${candidate.extraction_reason}`,
      exact_source_substring: true,
    });
  }).sort((left, right) => left.entry_id.localeCompare(right.entry_id));
  return protectedTransferIndexSchema.parse({
    profile_id: first.profile_id,
    corpus_hash: computeStyleCorpusHash(sortedDocuments),
    created_at: createdAt,
    entries,
  });
}

export async function writeProtectedTransferIndex(corpusRoot: string, index: ProtectedTransferIndex): Promise<string> {
  const root = await ensureStyleCorpus(corpusRoot);
  const parsed = protectedTransferIndexSchema.parse(index);
  const filename = path.join(root, 'cache', 'protected', `${parsed.profile_id}.protected.json`);
  await secureCorpusWrite(filename, `${JSON.stringify(parsed, null, 2)}\n`);
  return filename;
}

export async function loadProtectedTransferIndex(corpusRoot: string, profileId: string): Promise<ProtectedTransferIndex | null> {
  const root = await ensureStyleCorpus(corpusRoot);
  const filename = path.join(root, 'cache', 'protected', `${profileId}.protected.json`);
  try {
    return protectedTransferIndexSchema.parse(JSON.parse(await readPrivateCorpusFile(filename, root)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof z.ZodError || error instanceof SyntaxError) throw new Error('protected_index_invalid');
    throw error;
  }
}

export interface ResolvedProtectedTransferIndexes { readonly kind: 'resolved_protected_transfer_indexes' }
const resolvedProtectedIndexes = new WeakMap<object, readonly ProtectedTransferIndex[]>();

function makeResolved(indexes: readonly ProtectedTransferIndex[]): ResolvedProtectedTransferIndexes {
  const value = Object.freeze({ kind: 'resolved_protected_transfer_indexes' as const });
  resolvedProtectedIndexes.set(value, Object.freeze(indexes.map((index) => protectedTransferIndexSchema.parse(index))));
  return value;
}

export function resolveFixtureProtectedTransferIndexes(indexes: readonly ProtectedTransferIndex[] = []): ResolvedProtectedTransferIndexes {
  return makeResolved(indexes);
}

export async function resolveProtectedTransferIndexes(corpusRoot: string, documents: readonly CorpusDocument[]): Promise<ResolvedProtectedTransferIndexes> {
  let root: string;
  try { root = await ensureStyleCorpus(corpusRoot); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/permission|insecure|symlink|outside_corpus|special_file/iu.test(message)) throw new Error('protected_index_insecure');
    throw error;
  }
  const groups = new Map<string, CorpusDocument[]>();
  for (const document of documents) {
    if (document.rights_status === 'public_reference' && document.profile_type === 'reference_technique') {
      groups.set(document.profile_id, [...(groups.get(document.profile_id) ?? []), document]);
    }
  }
  const indexes: ProtectedTransferIndex[] = [];
  for (const [profileId, profileDocuments] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    let index: ProtectedTransferIndex | null;
    try {
      index = await loadProtectedTransferIndex(root, profileId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/permission|insecure|symlink|outside_corpus|special_file/iu.test(message)) throw new Error('protected_index_insecure');
      if (message === 'protected_index_invalid') throw error;
      throw new Error('protected_index_invalid');
    }
    if (index === null) throw new Error('protected_index_missing');
    if (index.profile_id !== profileId) throw new Error('protected_index_invalid');
    if (index.corpus_hash !== computeStyleCorpusHash(profileDocuments)) throw new Error('protected_index_stale');
    indexes.push(index);
  }
  return makeResolved(indexes);
}

export function resolvedProtectedTransferIndexRecords(value: ResolvedProtectedTransferIndexes): readonly ProtectedTransferIndex[] {
  if (value === null || typeof value !== 'object') throw new Error('unresolved_protected_transfer_indexes');
  const indexes = resolvedProtectedIndexes.get(value);
  if (indexes === undefined) throw new Error('unresolved_protected_transfer_indexes');
  return indexes.map((index) => protectedTransferIndexSchema.parse(index));
}

export function protectedEntriesForGuard(value: ResolvedProtectedTransferIndexes): {
  signaturePhrases: string[];
  uniqueMetaphors: string[];
  personalExperienceEntities: string[];
  distinctiveShortFragments: string[];
} {
  const indexes = resolvedProtectedTransferIndexRecords(value);
  const values = (kind: ProtectedTransferEntry['kind']) => indexes.flatMap(({ entries }) => entries.filter((entry) => entry.kind === kind).map(({ text }) => text));
  return {
    signaturePhrases: values('signature_phrase'),
    uniqueMetaphors: values('unique_metaphor'),
    personalExperienceEntities: values('personal_experience_entity'),
    distinctiveShortFragments: values('distinctive_short_fragment'),
  };
}

export function protectedEntryCounts(index: ProtectedTransferIndex): Record<ProtectedTransferEntry['kind'], number> {
  return Object.fromEntries(protectedKindSchema.options.map((kind) => [kind, index.entries.filter((entry) => entry.kind === kind).length])) as Record<ProtectedTransferEntry['kind'], number>;
}
