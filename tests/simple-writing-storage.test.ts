import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runSimpleWritingBuild } from '../src/simple-writing/pipeline.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(outputRoot?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'simple-writing-storage-'));
  roots.push(root);
  return runSimpleWritingBuild({
    rootDir: process.cwd(),
    writingDate: '2026-08-14',
    fixture: true,
    dryRun: true,
    outputRoot: outputRoot ?? path.join(root, 'review'),
    now: new Date('2026-08-14T06:30:00.000Z'),
  });
}

describe('Simple Writing private storage', () => {
  it('uses 0700 for the review directory and 0600 for every file', async () => {
    const run = await fixture();
    const directory = run.output_directory ?? '';
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    for (const file of Object.values(run.files ?? {})) {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it('keeps internal material IDs in sources.md but out of article.md', async () => {
    const run = await fixture();
    const article = await readFile(run.files?.article ?? '', 'utf8');
    const sources = await readFile(run.files?.sources ?? '', 'utf8');
    expect(article).not.toContain('mat_111111111111');
    expect(sources).toContain('mat_111111111111');
    expect(sources).toContain('素材角色：fact_source');
    expect(sources).toContain('https://example.com/synthetic-workflow-guide');
  });

  it('writes warnings and the fixed unpublished reminder to review-notes.md', async () => {
    const run = await fixture();
    const notes = await readFile(run.files?.reviewNotes ?? '', 'utf8');
    expect(notes).toContain('promised_artifact_missing');
    expect(notes).toContain('这是 AI 生成草稿，尚未发布，请人工检查事实、表达、标题和引用来源。');
  });

  it('refuses to write a draft anywhere inside the Git repository', async () => {
    const forbidden = path.join(process.cwd(), 'data', 'simple-writing-should-not-exist');
    const run = await fixture(forbidden);
    expect(run.pack).toMatchObject({ status: 'failed', decision: null, error_code: 'storage_failed', model: { calls: 1 } });
    await expect(access(forbidden)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
