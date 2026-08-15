import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureStyleCorpus, loadCorpusDocuments, secureCorpusWrite } from '../src/style-intelligence/corpus.js';
import { distillStyleProfile } from '../src/style-intelligence/distill.js';
import { buildStyleFixtureDocuments, FixtureStyleProvider } from '../src/style-intelligence/fixture.js';
import { computeStyleCorpusHash, sha256 } from '../src/style-intelligence/hash.js';
import {
  buildProtectedTransferIndex,
  resolveFixtureProtectedTransferIndexes,
  resolveProtectedTransferIndexes,
  resolvedProtectedTransferIndexRecords,
  writeProtectedTransferIndex,
} from '../src/style-intelligence/protected-transfer.js';
import type { CorpusDocument } from '../src/style-intelligence/types.js';
import { guardAgainstPlagiarism } from '../src/writing-lint/plagiarism-guard.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function persistDocuments(corpusRoot: string, documents: readonly CorpusDocument[]): Promise<void> {
  const root = await ensureStyleCorpus(corpusRoot);
  for (const document of documents) {
    const directory = document.profile_type === 'owner_voice' ? 'owner' : 'references';
    await secureCorpusWrite(path.join(root, directory, `${document.document_id}.json`), `${JSON.stringify(document, null, 2)}\n`);
  }
}

async function lintOutput(corpusRoot: string, draft: string): Promise<{ code: number; output: Record<string, any> }> {
  const draftPath = path.join(path.dirname(corpusRoot), `draft-${Math.random().toString(16).slice(2)}.md`);
  await writeFile(draftPath, draft);
  try {
    const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', 'scripts/style-lint.ts', '--draft', draftPath, '--corpus-root', corpusRoot], { cwd: process.cwd() });
    return { code: 0, output: JSON.parse(stdout) as Record<string, any> };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string };
    return { code: failure.code ?? 1, output: JSON.parse(failure.stdout ?? '{}') as Record<string, any> };
  }
}

function publicDocuments(profileId = 'protected-reference'): CorpusDocument[] {
  return buildStyleFixtureDocuments({ profileId, profileType: 'reference_technique', rightsStatus: 'public_reference' });
}

describe('Protected Transfer candidate verification', () => {
  it('ignores a claimed source A and records only the real containing source B', () => {
    const documents = publicDocuments('candidate-real-source').slice(0, 2);
    const phrase = '只存在于第二篇的连续短语';
    documents[0] = { ...documents[0]!, text: '第一篇没有目标文本。' };
    documents[1] = { ...documents[1]!, text: `第二篇包含${phrase}并继续。` };
    const index = buildProtectedTransferIndex(documents, [{ kind: 'distinctive_short_fragment', text: phrase, source_document_ids: [documents[0]!.document_id], extraction_reason: 'untrusted claim' }]);
    expect(index.entries[0]!.source_document_ids).toEqual([documents[1]!.document_id]);
  });

  it('records every real containing document in stable order and deduplicates candidates', () => {
    const documents = publicDocuments('candidate-multiple-sources').slice(0, 2);
    const phrase = '两篇都出现的精确短语';
    documents[0] = { ...documents[0]!, text: `甲${phrase}。` };
    documents[1] = { ...documents[1]!, text: `乙${phrase}。` };
    const candidate = { kind: 'distinctive_short_fragment' as const, text: phrase, source_document_ids: [], extraction_reason: 'duplicate fixture' };
    const index = buildProtectedTransferIndex(documents, [candidate, candidate]);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]!.source_document_ids).toEqual(documents.map(({ document_id }) => document_id).sort());
  });

  it('rejects a candidate that is not an exact source substring', () => {
    const documents = publicDocuments('candidate-missing').slice(0, 2);
    expect(() => buildProtectedTransferIndex(documents, [{ kind: 'unique_metaphor', text: '语料里不存在的比喻', source_document_ids: [], extraction_reason: 'invalid fixture' }])).toThrow('protected_candidate_not_exact_source_substring');
  });

  it('rejects a hinted source document ID that is not in the Profile corpus', () => {
    const documents = publicDocuments('candidate-unknown-source').slice(0, 2);
    expect(() => buildProtectedTransferIndex(documents, [{ kind: 'distinctive_short_fragment', text: '页面会保留原输入', source_document_ids: ['doc_0000000000000000'], extraction_reason: 'unknown source hint' }])).toThrow('protected_candidate_source_missing');
  });

  it('returns Profile and automatically built Index from the same Distill call', async () => {
    const documents = publicDocuments('automatic-index');
    const result = await distillStyleProfile({ documents, provider: new FixtureStyleProvider(), createdAt: '2026-08-15T00:00:00.000Z' });
    expect(result).toMatchObject({ model_calls: 1, profile: { protected_index_status: 'ready' }, protected_index: { profile_id: 'automatic-index' } });
    expect(result.protected_index!.corpus_hash).toBe(result.profile.corpus_hash);
    expect(result.protected_index!.corpus_hash).toBe(computeStyleCorpusHash(documents));
  });

  it('regenerates rather than reusing an Index after corpus text changes', async () => {
    const documents = publicDocuments('regenerate-stale');
    const oldIndex = buildProtectedTransferIndex(documents, [], '2026-08-15T00:00:00.000Z');
    const changed = documents.map((document, index) => index === 1 ? { ...document, text: `${document.text} 新增变化。`, content_sha256: sha256(`${document.text} 新增变化。`) } : document);
    const result = await distillStyleProfile({ documents: changed, provider: new FixtureStyleProvider(), existingProtectedIndex: oldIndex, createdAt: '2026-08-16T00:00:00.000Z' });
    expect(result.protected_index!.corpus_hash).not.toBe(oldIndex.corpus_hash);
    expect(result.protected_index!.corpus_hash).toBe(result.profile.corpus_hash);
  });
});

describe('fail-closed Protected Transfer resolution', () => {
  it('blocks lint when a public-reference Index is missing', async () => {
    const root = await temporaryRoot('protected-missing-');
    const corpusRoot = path.join(root, 'corpus');
    await persistDocuments(corpusRoot, publicDocuments('missing-index'));
    expect(await lintOutput(corpusRoot, '这是一篇独立检查稿。')).toMatchObject({ code: 1, output: { status: 'blocked', error_code: 'protected_index_missing' } });
  });

  it('blocks lint when an Index corpus hash is stale', async () => {
    const root = await temporaryRoot('protected-stale-');
    const corpusRoot = path.join(root, 'corpus');
    const documents = publicDocuments('stale-index');
    await persistDocuments(corpusRoot, documents);
    await writeProtectedTransferIndex(corpusRoot, buildProtectedTransferIndex(documents, []));
    const changedText = `${documents[0]!.text} 语料已变化。`;
    const changed = { ...documents[0]!, text: changedText, content_sha256: sha256(changedText) };
    await secureCorpusWrite(path.join(corpusRoot, 'references', `${changed.document_id}.json`), `${JSON.stringify(changed, null, 2)}\n`);
    expect(await lintOutput(corpusRoot, '这是一篇独立检查稿。')).toMatchObject({ code: 1, output: { error_code: 'protected_index_stale' } });
  });

  it('blocks lint when the file contains a mismatched profile ID', async () => {
    const root = await temporaryRoot('protected-mismatch-');
    const corpusRoot = path.join(root, 'corpus');
    const documents = publicDocuments('expected-profile');
    await persistDocuments(corpusRoot, documents);
    const index = buildProtectedTransferIndex(documents, []);
    await secureCorpusWrite(path.join(corpusRoot, 'cache', 'protected', 'expected-profile.protected.json'), `${JSON.stringify({ ...index, profile_id: 'different-profile' }, null, 2)}\n`);
    expect(await lintOutput(corpusRoot, '这是一篇独立检查稿。')).toMatchObject({ code: 1, output: { error_code: 'protected_index_invalid' } });
  });

  it('blocks lint when an Index path is a symlink', async () => {
    const root = await temporaryRoot('protected-symlink-');
    const corpusRoot = path.join(root, 'corpus');
    const documents = publicDocuments('symlink-index');
    await persistDocuments(corpusRoot, documents);
    const externalIndex = path.join(root, 'external-index.json');
    await writeFile(externalIndex, `${JSON.stringify(buildProtectedTransferIndex(documents, []), null, 2)}\n`, { mode: 0o600 });
    await chmod(externalIndex, 0o600);
    await symlink(externalIndex, path.join(corpusRoot, 'cache', 'protected', 'symlink-index.protected.json'));
    expect(await lintOutput(corpusRoot, '这是一篇独立检查稿。')).toMatchObject({ code: 1, output: { error_code: 'protected_index_insecure' } });
  });

  it('uses a valid Index to catch a short signature phrase', async () => {
    const root = await temporaryRoot('protected-valid-');
    const corpusRoot = path.join(root, 'corpus');
    const documents = publicDocuments('valid-index');
    const phrase = '页面会保留原输入';
    await persistDocuments(corpusRoot, documents);
    await writeProtectedTransferIndex(corpusRoot, buildProtectedTransferIndex(documents, [{ kind: 'signature_phrase', text: phrase, source_document_ids: [], extraction_reason: 'valid fixture' }]));
    const result = await lintOutput(corpusRoot, `这里复制了短语：${phrase}`);
    expect(result.code).toBe(1);
    expect(result.output.issues.map(({ issue_code }: { issue_code: string }) => issue_code)).toContain('signature_phrase_transfer');
  });

  it('does not require an Index for an owner corpus', async () => {
    const root = await temporaryRoot('protected-owner-');
    const corpusRoot = path.join(root, 'corpus');
    const documents = buildStyleFixtureDocuments({ profileId: 'owner-no-index' });
    await persistDocuments(corpusRoot, documents);
    const resolved = await resolveProtectedTransferIndexes(corpusRoot, await loadCorpusDocuments(corpusRoot));
    expect(resolvedProtectedTransferIndexRecords(resolved)).toEqual([]);
  });

  it('requires an opaque Resolver result and keeps fixture bypass explicit', () => {
    expect(() => guardAgainstPlagiarism({ draft: '独立稿件', corpus: [], protectedIndexes: [] as never })).toThrow('unresolved_protected_transfer_indexes');
    expect(guardAgainstPlagiarism({ draft: '独立稿件', corpus: [], protectedIndexes: resolveFixtureProtectedTransferIndexes() }).status).toBe('pass');
  });

  it('inspects only metadata and counts, never protected phrase text', async () => {
    const root = await temporaryRoot('protected-inspect-');
    const corpusRoot = path.join(root, 'corpus');
    const documents = publicDocuments('inspect-index');
    const phrase = '页面会保留原输入';
    await persistDocuments(corpusRoot, documents);
    await writeProtectedTransferIndex(corpusRoot, buildProtectedTransferIndex(documents, [{ kind: 'signature_phrase', text: phrase, source_document_ids: [], extraction_reason: 'inspect fixture' }], '2026-08-15T00:00:00.000Z'));
    const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', 'scripts/style-protected-inspect.ts', '--corpus-root', corpusRoot, '--profile-id', 'inspect-index'], { cwd: process.cwd() });
    expect(JSON.parse(stdout)).toEqual({
      profile_id: 'inspect-index',
      corpus_hash: computeStyleCorpusHash(documents),
      created_at: '2026-08-15T00:00:00.000Z',
      status: 'ready',
      counts: { signature_phrase: 1, unique_metaphor: 0, personal_experience_entity: 0, distinctive_short_fragment: 0 },
    });
    expect(stdout).not.toContain(phrase);
  });
});
