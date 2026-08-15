import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureStyleCorpus, importCorpusDocuments, inspectCorpusPermissions, inspectStyleCorpus } from '../src/style-intelligence/corpus.js';
import { loadStyleFeedback, proposeProfileDelta, recordStyleFeedback } from '../src/style-intelligence/feedback.js';
import { buildStyleFixtureDocuments } from '../src/style-intelligence/fixture.js';
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

describe('private corpus, plagiarism, and feedback learning', () => {
  it('creates local corpus directories as 0700 and files as 0600', async () => {
    const root = await temporaryRoot('style-corpus-permissions-');
    await ensureStyleCorpus(root);
    expect(await inspectCorpusPermissions(root)).toEqual({ directories_secure: true, files_secure: true });
  });

  it('imports Markdown, text, and JSONL into private local documents without exposing text in inspection', async () => {
    const root = await temporaryRoot('style-corpus-import-');
    const sourceRoot = await temporaryRoot('style-sources-');
    const sources = [
      ['sample.md', '# 样本\n\n这是一份 Markdown 样本。'],
      ['sample.txt', '这是一份纯文本样本。'],
      ['sample.jsonl', '{"title":"一","text":"第一份 JSONL 样本。"}\n{"text":"第二份 JSONL 样本。"}\n'],
    ] as const;
    for (const [filename, content] of sources) {
      const sourcePath = path.join(sourceRoot, filename);
      await writeFile(sourcePath, content);
      await importCorpusDocuments({ corpusRoot: root, sourcePath, profileId: 'owner-local', profileType: 'owner_voice', rightsStatus: 'owned_by_user', platform: 'wechat', contentType: 'tutorial', importedAt: '2026-08-15T00:00:00.000Z' });
    }
    const inspection = await inspectStyleCorpus(root);
    expect(inspection.document_count).toBe(4);
    expect(JSON.stringify(inspection)).not.toContain('Markdown 样本');
    expect(inspection.permissions).toEqual({ directories_secure: true, files_secure: true });
  });

  it('rejects a corpus path inside the Git repository and keeps ignore guards committed', async () => {
    const sourceRoot = await temporaryRoot('style-source-reject-');
    const source = path.join(sourceRoot, 'sample.md');
    await writeFile(source, '完整文章不得进入 Git。');
    await expect(importCorpusDocuments({ corpusRoot: path.join(process.cwd(), 'style-corpus'), sourcePath: source, profileId: 'owner-local', profileType: 'owner_voice', rightsStatus: 'owned_by_user', platform: 'wechat', contentType: 'tutorial' })).rejects.toThrow('style_corpus_must_be_outside_repository');
    expect(await readFile(path.join(process.cwd(), '.gitignore'), 'utf8')).toMatch(/\*\*\/style-corpus\//u);
  });

  it('exempts an exact Research quote only when it maps to a Claim ID', () => {
    const corpus = buildStyleFixtureDocuments({ profileId: 'public-ref', profileType: 'reference_technique', rightsStatus: 'public_reference' });
    const quote = corpus[0]!.text;
    expect(guardAgainstPlagiarism({ draft: `引用如下：${quote}`, corpus }).status).toBe('blocked');
    expect(guardAgainstPlagiarism({ draft: `引用如下：${quote}`, corpus, authorizedQuotes: [{ claim_id: 'claim_verified_1', quote }] }).status).toBe('pass');
    expect(guardAgainstPlagiarism({ draft: `引用如下：${quote}`, corpus, authorizedQuotes: [{ claim_id: 'bad-id', quote }] }).status).toBe('blocked');
  });

  it('hard-blocks unauthorized continuous text and 12-gram overlap from a public reference', () => {
    const corpus = buildStyleFixtureDocuments({ profileId: 'public-ref', profileType: 'reference_technique', rightsStatus: 'public_reference' });
    const result = guardAgainstPlagiarism({ draft: corpus.map(({ text }) => text).join('另外补一句。'), corpus });
    expect(result.status).toBe('blocked');
    expect(result.issues).toContainEqual(expect.objectContaining({ issue_code: 'public_reference_text_overlap', severity: 'hard_blocker' }));
  });

  it('hard-blocks signature phrases, unique metaphors, and personal-experience entities', () => {
    const result = guardAgainstPlagiarism({
      draft: '他提到月光下的齿轮，并讲起星河学校的往事。这就是他的独门收尾。', corpus: [],
      signaturePhrases: ['这就是他的独门收尾'], uniqueMetaphors: ['月光下的齿轮'], personalExperienceEntities: ['星河学校'],
    });
    expect(result.issues.map(({ issue_code }) => issue_code)).toEqual(expect.arrayContaining(['signature_phrase_transfer', 'unique_metaphor_transfer', 'personal_experience_transfer']));
  });

  it('does not propose a Profile delta after one edit and never updates a Profile automatically', async () => {
    const root = await temporaryRoot('style-feedback-one-');
    await recordStyleFeedback(root, { before: '旧稿', after: '新稿', accepted_changes: ['保留步骤'], rejected_changes: [], reason_labels: ['more_concrete'], platform: 'wechat', article_type: 'tutorial', timestamp: '2026-08-15T01:00:00.000Z' });
    expect(proposeProfileDelta(await loadStyleFeedback(root))).toBeNull();
    await expect(stat(path.join(root, 'cache', 'profile.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('produces proposal-only delta after three consistent edits and still requires explicit approval', async () => {
    const root = await temporaryRoot('style-feedback-three-');
    for (let index = 0; index < 3; index += 1) {
      await recordStyleFeedback(root, { before: `旧稿${index}`, after: `新稿${index}`, accepted_changes: ['补充可验收动作'], rejected_changes: ['抽象总结'], reason_labels: ['more_concrete'], platform: 'wechat', article_type: 'tutorial', timestamp: `2026-08-15T0${index + 1}:00:00.000Z` });
    }
    expect(proposeProfileDelta(await loadStyleFeedback(root))).toMatchObject({ status: 'proposal_only', occurrences: 3, requires_explicit_user_approval: true });
  });
});
