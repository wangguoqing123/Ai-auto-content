import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ensureStyleCorpus, secureCorpusWrite } from './corpus.js';
import { sha256, stableJson } from './hash.js';
import type { CorpusDocument } from './types.js';

const protectedKindSchema = z.enum(['signature_phrase', 'unique_metaphor', 'personal_experience_entity', 'distinctive_short_fragment']);

export const protectedTransferEntrySchema = z.strictObject({
  entry_id: z.string().regex(/^protected_[a-f0-9]{16}$/),
  kind: protectedKindSchema,
  text: z.string().trim().min(1).max(500),
  normalized_text: z.string().trim().min(1).max(500),
  source_document_ids: z.array(z.string().regex(/^doc_[a-f0-9]{16}$/)).min(1).max(30),
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

export type ProtectedTransferEntry = z.infer<typeof protectedTransferEntrySchema>;
export type ProtectedTransferIndex = z.infer<typeof protectedTransferIndexSchema>;
export type ProtectedTransferCandidate = Pick<ProtectedTransferEntry, 'kind' | 'text' | 'source_document_ids' | 'extraction_method'>;

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
  const byId = new Map(sortedDocuments.map((document) => [document.document_id, document]));
  const entries = candidates.map((candidate) => {
    const sources = candidate.source_document_ids.map((documentId) => byId.get(documentId));
    if (sources.some((document) => document === undefined)) throw new Error('protected_candidate_source_missing');
    if (!sources.some((document) => document!.text.includes(candidate.text))) throw new Error('protected_candidate_not_exact_source_substring');
    return protectedTransferEntrySchema.parse({
      ...candidate,
      entry_id: `protected_${sha256(stableJson({ profile_id: first.profile_id, kind: candidate.kind, text: candidate.text })).slice(0, 16)}`,
      normalized_text: normalize(candidate.text),
      exact_source_substring: true,
    });
  });
  return protectedTransferIndexSchema.parse({
    profile_id: first.profile_id,
    corpus_hash: sha256(stableJson(sortedDocuments.map(({ document_id, title, text }) => ({ document_id, title, text })))),
    created_at: createdAt,
    entries,
  });
}

export async function writeProtectedTransferIndex(corpusRoot: string, index: ProtectedTransferIndex): Promise<string> {
  await ensureStyleCorpus(corpusRoot);
  const parsed = protectedTransferIndexSchema.parse(index);
  const filename = path.join(corpusRoot, 'cache', 'protected', `${parsed.profile_id}.protected.json`);
  await secureCorpusWrite(filename, `${JSON.stringify(parsed, null, 2)}\n`);
  return filename;
}

export async function loadProtectedTransferIndex(corpusRoot: string, profileId: string): Promise<ProtectedTransferIndex | null> {
  await ensureStyleCorpus(corpusRoot);
  try {
    return protectedTransferIndexSchema.parse(JSON.parse(await readFile(path.join(corpusRoot, 'cache', 'protected', `${profileId}.protected.json`), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function protectedEntriesForGuard(indexes: readonly ProtectedTransferIndex[]): {
  signaturePhrases: string[];
  uniqueMetaphors: string[];
  personalExperienceEntities: string[];
  distinctiveShortFragments: string[];
} {
  const values = (kind: ProtectedTransferEntry['kind']) => indexes.flatMap(({ entries }) => entries.filter((entry) => entry.kind === kind).map(({ text }) => text));
  return {
    signaturePhrases: values('signature_phrase'),
    uniqueMetaphors: values('unique_metaphor'),
    personalExperienceEntities: values('personal_experience_entity'),
    distinctiveShortFragments: values('distinctive_short_fragment'),
  };
}
