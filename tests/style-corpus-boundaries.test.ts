import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultStyleCorpusRoot,
  ensureStyleCorpus,
  importCorpusDocuments,
  loadCorpusDocuments,
  secureCorpusWrite,
} from '../src/style-intelligence/corpus.js';
import type { CorpusImportOptions } from '../src/style-intelligence/types.js';

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

function trustedOptions(corpusRoot: string, sourcePath: string): CorpusImportOptions {
  return {
    corpusRoot,
    sourcePath,
    profileId: 'jsonl-owner',
    profileType: 'owner_voice',
    rightsStatus: 'owned_by_user',
    platform: 'wechat',
    contentType: 'tutorial',
    source: { creator_id: 'owner', creator_display_name: 'Owner', canonical_url: null, platform_item_id: 'trusted-default', published_at: '2026-08-14T00:00:00.000Z' },
    rights: { basis: 'user_owned', permission_reference: 'trusted-command', confirmed_at: '2026-08-15T00:00:00.000Z' },
    modelProcessing: { allowed: false, consent_recorded_at: '2026-08-15T00:00:00.000Z' },
    importedAt: '2026-08-15T00:00:00.000Z',
  };
}

function styleImportArgs(corpusRoot: string, sourcePath: string): string[] {
  return [
    '--import', 'tsx', 'scripts/style-import.ts', '--corpus-root', corpusRoot, '--source', sourcePath,
    '--profile-id', 'jsonl-owner', '--profile-type', 'owner_voice', '--rights-status', 'owned_by_user',
    '--platform', 'wechat', '--content-type', 'tutorial', '--creator-id', 'owner', '--creator-name', 'Owner',
    '--platform-item-id', 'trusted-default', '--published-at', '2026-08-14T00:00:00.000Z',
    '--rights-basis', 'user_owned', '--permission-reference', 'trusted-command', '--rights-confirmed-at', '2026-08-15T00:00:00.000Z',
    '--model-processing', 'denied', '--consent-recorded-at', '2026-08-15T00:00:00.000Z',
  ];
}

describe('JSONL authority boundaries', () => {
  it('rejects inline model permission when the trusted CLI says denied and saves no document', async () => {
    const root = await temporaryRoot('jsonl-inline-model-');
    const corpusRoot = path.join(root, 'corpus');
    const source = path.join(root, 'source.jsonl');
    await writeFile(source, JSON.stringify({ title: 'bad', text: '正文', model_processing: { allowed: true } }));
    await expect(execFileAsync(process.execPath, styleImportArgs(corpusRoot, source), { cwd: process.cwd() })).rejects.toMatchObject({ stderr: expect.stringContaining('inline_model_processing_metadata_not_allowed') });
    expect(await loadCorpusDocuments(corpusRoot)).toEqual([]);
  });

  it('rejects inline rights metadata when the trusted CLI declares user ownership', async () => {
    const root = await temporaryRoot('jsonl-inline-rights-');
    const corpusRoot = path.join(root, 'corpus');
    const source = path.join(root, 'source.jsonl');
    await writeFile(source, JSON.stringify({ title: 'bad', text: '正文', rights: { basis: 'public_reference_analysis' } }));
    await expect(execFileAsync(process.execPath, styleImportArgs(corpusRoot, source), { cwd: process.cwd() })).rejects.toMatchObject({ stderr: expect.stringContaining('inline_rights_metadata_not_allowed') });
    expect(await loadCorpusDocuments(corpusRoot)).toEqual([]);
  });

  it('allows per-document canonical URLs and item IDs while preserving trusted rights and consent', async () => {
    const root = await temporaryRoot('jsonl-source-overrides-');
    const corpusRoot = path.join(root, 'corpus');
    const source = path.join(root, 'source.jsonl');
    await writeFile(source, [
      JSON.stringify({ title: 'one', text: '第一篇正文。', source: { canonical_url: 'https://example.com/one', platform_item_id: 'one' } }),
      JSON.stringify({ title: 'two', text: '第二篇正文。', source: { canonical_url: 'https://example.com/two', platform_item_id: 'two' } }),
    ].join('\n'));
    const documents = await importCorpusDocuments(trustedOptions(corpusRoot, source));
    expect(documents.map(({ source: provenance }) => [provenance.canonical_url, provenance.platform_item_id])).toEqual([
      ['https://example.com/one', 'one'],
      ['https://example.com/two', 'two'],
    ]);
    expect(documents.every(({ rights, model_processing }) => rights.basis === 'user_owned' && rights.permission_reference === 'trusted-command' && model_processing.allowed === false && model_processing.provider_scope === 'none')).toBe(true);
  });

  it('does not mistake the ordinary text string model_processing for metadata', async () => {
    const root = await temporaryRoot('jsonl-ordinary-string-');
    const corpusRoot = path.join(root, 'corpus');
    const source = path.join(root, 'source.jsonl');
    await writeFile(source, JSON.stringify({ title: 'ordinary', text: '正文里讨论字符串 “model_processing”，它不是授权字段。' }));
    const documents = await importCorpusDocuments(trustedOptions(corpusRoot, source));
    expect(documents).toHaveLength(1);
    expect(documents[0]!.text).toContain('model_processing');
  });
});

describe('realpath and symlink boundaries', () => {
  it('rejects a Corpus Root that is itself a symlink', async () => {
    const root = await temporaryRoot('corpus-root-link-');
    const target = path.join(root, 'target');
    const link = path.join(root, 'corpus');
    await mkdir(target);
    await symlink(target, link);
    await expect(ensureStyleCorpus(link)).rejects.toThrow('corpus_root_symlink_not_allowed');
  });

  it('rejects a symlinked owner directory on every subsequent read', async () => {
    const root = await temporaryRoot('corpus-owner-link-');
    const corpusRoot = path.join(root, 'corpus');
    await ensureStyleCorpus(corpusRoot);
    const externalOwner = path.join(root, 'external-owner');
    await mkdir(externalOwner);
    await rm(path.join(corpusRoot, 'owner'), { recursive: true });
    await symlink(externalOwner, path.join(corpusRoot, 'owner'));
    await expect(loadCorpusDocuments(corpusRoot)).rejects.toThrow(/symlink/iu);
  });

  it('rejects a source symlink, including one pointing into the repository', async () => {
    const root = await temporaryRoot('source-link-');
    const corpusRoot = path.join(root, 'corpus');
    const ordinaryTarget = path.join(root, 'ordinary-target.md');
    const ordinaryLink = path.join(root, 'ordinary-link.md');
    await writeFile(ordinaryTarget, '仓库外普通文件。');
    await symlink(ordinaryTarget, ordinaryLink);
    await expect(importCorpusDocuments(trustedOptions(corpusRoot, ordinaryLink))).rejects.toThrow('style_source_symlink_not_allowed');
    const repositoryLink = path.join(root, 'repository-link.md');
    await symlink(path.join(process.cwd(), 'README.md'), repositoryLink);
    await expect(importCorpusDocuments(trustedOptions(corpusRoot, repositoryLink))).rejects.toThrow('style_source_symlink_not_allowed');
  });

  it('rejects a regular source whose resolved path is inside the Git worktree', async () => {
    const root = await temporaryRoot('repository-source-boundary-');
    await expect(importCorpusDocuments(trustedOptions(path.join(root, 'corpus'), path.join(process.cwd(), 'README.md')))).rejects.toThrow('style_path_must_be_outside_repository');
  });

  it('allows a regular external source and the normal Application Support layout', async () => {
    const root = await temporaryRoot('normal-style-paths-');
    const corpusRoot = defaultStyleCorpusRoot(path.join(root, 'home'));
    const source = path.join(root, 'source.md');
    await writeFile(source, '# 普通外部语料\n\n只验证路径，不是正式语料。');
    await ensureStyleCorpus(corpusRoot);
    expect(await importCorpusDocuments(trustedOptions(corpusRoot, source))).toHaveLength(1);
    expect(await readFile(path.join(corpusRoot, 'sources.local.yaml'), 'utf8')).toContain('jsonl-owner');
  });

  it('writes atomically as 0600 and refuses an existing symlink target', async () => {
    const root = await temporaryRoot('secure-corpus-write-');
    const corpusRoot = path.join(root, 'corpus');
    await ensureStyleCorpus(corpusRoot);
    const target = path.join(corpusRoot, 'cache', 'atomic.json');
    await secureCorpusWrite(target, 'first');
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    expect(await readFile(target, 'utf8')).toBe('first');
    await rm(target);
    const external = path.join(root, 'external.json');
    await writeFile(external, 'unchanged');
    await symlink(external, target);
    await expect(secureCorpusWrite(target, 'must-not-follow')).rejects.toThrow('secure_write_target_symlink_not_allowed');
    expect(await readFile(external, 'utf8')).toBe('unchanged');
    expect((await readdir(path.dirname(target))).filter((name) => name.includes('.tmp'))).toEqual([]);
  });
});
