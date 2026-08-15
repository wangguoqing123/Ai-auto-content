import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureStyleCorpus, importCorpusDocuments, inspectCorpusPermissions, inspectStyleCorpus } from '../src/style-intelligence/corpus.js';
import { distillStyleProfile } from '../src/style-intelligence/distill.js';
import { computeStyleChangeSignature, loadStyleFeedback, proposeProfileDelta, recordStyleFeedback, type StyleFeedbackChange } from '../src/style-intelligence/feedback.js';
import { buildStyleFixtureDocuments, FixtureStyleProvider } from '../src/style-intelligence/fixture.js';
import { sha256 } from '../src/style-intelligence/hash.js';
import { buildProtectedTransferIndex, writeProtectedTransferIndex } from '../src/style-intelligence/protected-transfer.js';
import type { CorpusImportOptions } from '../src/style-intelligence/types.js';
import { guardAgainstPlagiarism } from '../src/writing-lint/plagiarism-guard.js';

const roots: string[] = [];
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function ownerImport(corpusRoot: string, sourcePath: string, itemId: string): CorpusImportOptions {
  return {
    corpusRoot, sourcePath, profileId: 'owner-local', profileType: 'owner_voice', rightsStatus: 'owned_by_user', platform: 'wechat', contentType: 'tutorial',
    source: { creator_id: 'creator-owner', creator_display_name: 'Owner', canonical_url: null, platform_item_id: itemId, published_at: '2026-08-14T00:00:00.000Z' },
    rights: { basis: 'user_owned', permission_reference: 'user-confirmed-owned-source', confirmed_at: '2026-08-15T00:00:00.000Z' },
    modelProcessing: { allowed: true, consent_recorded_at: '2026-08-15T00:00:00.000Z' },
    importedAt: '2026-08-15T00:00:00.000Z',
  };
}

const acceptedChange: StyleFeedbackChange = { change_id: 'change_action', direction: 'add', description: '补充可验收动作', affected_rule_id: 'rule_action' };
function feedbackInput(index: number, options: { pack?: string; draft?: string; rejected?: boolean; reason?: string; change?: StyleFeedbackChange } = {}) {
  const change = options.change ?? acceptedChange;
  const before = options.draft ?? `旧稿${index}`;
  const rejected = options.rejected ?? false;
  return {
    writing_pack_id: options.pack ?? `writing-pack-${index}`,
    writing_input_hash: sha256(`input-${index}`),
    draft_hash: sha256(before),
    profile_id: 'owner-local', profile_version: 1,
    change_signature: computeStyleChangeSignature([change]),
    before, after: `新稿${index}`,
    accepted_changes: rejected ? [] : [change],
    rejected_changes: rejected ? [change] : [],
    reason_labels: [options.reason ?? `reason-${index}`],
    platform: 'wechat', article_type: 'tutorial' as const, cross_type: false,
    timestamp: `2026-08-15T0${index}:00:00.000Z`,
  };
}

describe('private corpus provenance and transfer protection', () => {
  it('creates corpus and protected directories as 0700 and files as 0600', async () => {
    const root = await temporaryRoot('style-corpus-permissions-');
    await ensureStyleCorpus(root);
    expect(await inspectCorpusPermissions(root)).toEqual({ directories_secure: true, files_secure: true });
    expect((await stat(path.join(root, 'cache', 'protected'))).mode & 0o777).toBe(0o700);
  });

  it('records full per-document provenance and imports only new documents', async () => {
    const root = await temporaryRoot('style-corpus-import-');
    const sourceRoot = await temporaryRoot('style-sources-');
    const sourcePath = path.join(sourceRoot, 'sample.md');
    await writeFile(sourcePath, '# 样本\n\n这是一份 Markdown 样本。');
    const options = ownerImport(root, sourcePath, 'item-1');
    expect(await importCorpusDocuments(options)).toHaveLength(1);
    expect(await importCorpusDocuments(options)).toEqual([]);
    const inspection = await inspectStyleCorpus(root);
    expect(inspection.document_count).toBe(1);
    const registry = YAML.parse(await readFile(path.join(root, 'sources.local.yaml'), 'utf8')) as { sources: Array<Record<string, unknown>> };
    expect(registry.sources[0]).toMatchObject({
      source: { creator_id: 'creator-owner', platform_item_id: 'item-1', source_filename: 'sample.md' },
      rights: { basis: 'user_owned' }, model_processing: { allowed: true, provider_scope: 'codex_cli' },
    });
    expect(JSON.stringify(inspection)).not.toContain('Markdown 样本');
  });

  it('accepts JSONL per-document source metadata and deduplicates content hashes', async () => {
    const root = await temporaryRoot('style-corpus-jsonl-');
    const sourceRoot = await temporaryRoot('style-jsonl-source-');
    const sourcePath = path.join(sourceRoot, 'sample.jsonl');
    await writeFile(sourcePath, [
      JSON.stringify({ title: '一', text: '第一份 JSONL 样本。', source: { canonical_url: 'https://example.com/1', platform_item_id: 'jsonl-1' } }),
      JSON.stringify({ title: '二', text: '第二份 JSONL 样本。', source: { canonical_url: 'https://example.com/2', platform_item_id: 'jsonl-2' } }),
      JSON.stringify({ title: '重复', text: '第一份 JSONL 样本。', source: { canonical_url: 'https://example.com/3', platform_item_id: 'jsonl-3' } }),
    ].join('\n'));
    const documents = await importCorpusDocuments(ownerImport(root, sourcePath, 'base-jsonl'));
    expect(documents).toHaveLength(2);
    expect(documents.map(({ source }) => source.platform_item_id)).toEqual(['jsonl-1', 'jsonl-2']);
  });

  it('requires explicit processing permission and never calls a provider when denied', async () => {
    const documents = buildStyleFixtureDocuments().map((document) => ({ ...document, model_processing: { ...document.model_processing, allowed: false as const, provider_scope: 'none' as const } }));
    const provider = new FixtureStyleProvider();
    const result = await distillStyleProfile({ documents, provider });
    expect(result).toMatchObject({ model_calls: 0, profile: { status: 'processing_not_allowed', input_coverage: { supplied_chars: 0 } } });
    expect(provider.distillCalls).toBe(0);
  });

  it('rejects a corpus path inside the Git repository and keeps ignore guards committed', async () => {
    const sourceRoot = await temporaryRoot('style-source-reject-');
    const source = path.join(sourceRoot, 'sample.md');
    await writeFile(source, '完整文章不得进入 Git。');
    await expect(importCorpusDocuments(ownerImport(path.join(process.cwd(), 'style-corpus'), source, 'reject'))).rejects.toThrow('style_corpus_must_be_outside_repository');
    expect(await readFile(path.join(process.cwd(), '.gitignore'), 'utf8')).toMatch(/\*\*\/style-corpus\//u);
  });

  it('writes only source-exact protected entries and the guard checks them automatically', async () => {
    const root = await temporaryRoot('style-protected-');
    const corpus = buildStyleFixtureDocuments({ profileId: 'public-ref', profileType: 'reference_technique', rightsStatus: 'public_reference' });
    const phrase = '页面会保留原输入';
    const index = buildProtectedTransferIndex(corpus, [
      { kind: 'signature_phrase', text: phrase, source_document_ids: [corpus[0]!.document_id], extraction_method: 'fixture-test-exact-substring' },
      { kind: 'unique_metaphor', text: '任务跑了一遍', source_document_ids: [corpus[0]!.document_id], extraction_method: 'fixture-test-exact-substring' },
    ], '2026-08-15T00:00:00.000Z');
    const filename = await writeProtectedTransferIndex(root, index);
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
    expect(guardAgainstPlagiarism({ draft: `这句照搬了：${phrase}`, corpus: [], protectedIndexes: [index] }).issues.map(({ issue_code }) => issue_code)).toContain('signature_phrase_transfer');
    expect(() => buildProtectedTransferIndex(corpus, [{ kind: 'unique_metaphor', text: '原文没有的比喻', source_document_ids: [corpus[0]!.document_id], extraction_method: 'bad' }])).toThrow('protected_candidate_not_exact_source_substring');
  });
});

describe('feedback consensus', () => {
  it('does not propose after one edit and never updates a Profile automatically', async () => {
    const root = await temporaryRoot('style-feedback-one-');
    await recordStyleFeedback(root, feedbackInput(1));
    expect(proposeProfileDelta(await loadStyleFeedback(root))).toBeNull();
    await expect(stat(path.join(root, 'cache', 'profile.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires three distinct Writing Packs and draft hashes', async () => {
    const root = await temporaryRoot('style-feedback-dedupe-');
    for (let index = 1; index <= 3; index += 1) await recordStyleFeedback(root, feedbackInput(index, { pack: 'same-pack' }));
    expect(proposeProfileDelta(await loadStyleFeedback(root))).toBeNull();
    const draftRoot = await temporaryRoot('style-feedback-draft-dedupe-');
    for (let index = 1; index <= 3; index += 1) await recordStyleFeedback(draftRoot, feedbackInput(index, { draft: 'same-draft' }));
    expect(proposeProfileDelta(await loadStyleFeedback(draftRoot))).toBeNull();
  });

  it('uses change_signature rather than reason-label equality', async () => {
    const root = await temporaryRoot('style-feedback-signature-');
    for (let index = 1; index <= 3; index += 1) await recordStyleFeedback(root, feedbackInput(index, { reason: `different-${index}` }));
    expect(proposeProfileDelta(await loadStyleFeedback(root))).toMatchObject({ occurrences: 3, reason_labels: ['different-1', 'different-2', 'different-3'] });
    const oppositeRoot = await temporaryRoot('style-feedback-opposite-');
    for (let index = 1; index <= 3; index += 1) {
      const change = { ...acceptedChange, direction: index % 2 === 0 ? 'remove' : 'add' };
      await recordStyleFeedback(oppositeRoot, feedbackInput(index, { reason: 'same-label', change }));
    }
    expect(proposeProfileDelta(await loadStyleFeedback(oppositeRoot))).toBeNull();
  });

  it('returns supporting IDs for three consistent edits and blocks an explicit rejection', async () => {
    const root = await temporaryRoot('style-feedback-three-');
    for (let index = 1; index <= 3; index += 1) await recordStyleFeedback(root, feedbackInput(index));
    expect(proposeProfileDelta(await loadStyleFeedback(root))).toMatchObject({
      status: 'proposal_only', occurrences: 3, supporting_feedback_ids: expect.any(Array), conflict_count: 0, requires_explicit_user_approval: true,
    });
    expect(proposeProfileDelta(await loadStyleFeedback(root))!.supporting_feedback_ids).toHaveLength(3);
    await recordStyleFeedback(root, feedbackInput(4, { rejected: true }));
    expect(proposeProfileDelta(await loadStyleFeedback(root))).toBeNull();
  });
});
