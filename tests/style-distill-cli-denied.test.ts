import { execFile } from 'node:child_process';
import { chmod, mkdtemp, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { importCorpusDocuments } from '../src/style-intelligence/corpus.js';
import type { CorpusImportOptions } from '../src/style-intelligence/types.js';

const execFileAsync = promisify(execFile);
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

function importOptions(corpusRoot: string, sourcePath: string, itemId: string, allowed: boolean): CorpusImportOptions {
  return {
    corpusRoot,
    sourcePath,
    profileId: 'cli-denied-owner',
    profileType: 'owner_voice',
    rightsStatus: 'owned_by_user',
    platform: 'wechat',
    contentType: 'tutorial',
    source: { creator_id: 'owner', creator_display_name: 'Owner', canonical_url: null, platform_item_id: itemId, published_at: '2026-08-14T00:00:00.000Z' },
    rights: { basis: 'user_owned', permission_reference: 'trusted-test-command', confirmed_at: '2026-08-15T00:00:00.000Z' },
    modelProcessing: { allowed, consent_recorded_at: '2026-08-15T00:00:00.000Z' },
    importedAt: '2026-08-15T00:00:00.000Z',
  };
}

async function installFailingFakeCodex(root: string): Promise<{ bin: string; marker: string }> {
  const bin = path.join(root, 'fake-bin');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(bin);
  const marker = path.join(root, 'codex-was-executed');
  const executable = path.join(bin, 'codex');
  await writeFile(executable, `#!/bin/sh\n/usr/bin/touch ${JSON.stringify(marker)}\nexit 99\n`);
  await chmod(executable, 0o700);
  return { bin, marker };
}

async function runDeniedCase(allowedCount: number, deniedCount: number): Promise<{ output: Record<string, unknown>; marker: string }> {
  const root = await temporaryRoot('style-distill-denied-cli-');
  const corpusRoot = path.join(root, 'corpus');
  for (let index = 0; index < allowedCount + deniedCount; index += 1) {
    const sourcePath = path.join(root, `sample-${index}.txt`);
    await writeFile(sourcePath, `离线语料 ${index}，只用于验证 denied 路径不会启动 Codex。`);
    await importCorpusDocuments(importOptions(corpusRoot, sourcePath, `item-${index}`, index < allowedCount));
  }
  const { bin, marker } = await installFailingFakeCodex(root);
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: bin };
  delete env.STYLE_CODEX_MODEL;
  delete env.STYLE_CODEX_BIN;
  const { stdout } = await execFileAsync(process.execPath, [
    '--import', 'tsx', 'scripts/style-distill.ts',
    '--corpus-root', corpusRoot,
    '--profile-id', 'cli-denied-owner',
  ], { cwd: process.cwd(), env });
  return { output: JSON.parse(stdout) as Record<string, unknown>, marker };
}

describe('style:distill denied CLI path', () => {
  it('does not read model configuration or execute Codex for eight denied documents', async () => {
    const { output, marker } = await runDeniedCase(0, 8);
    expect(output).toMatchObject({ status: 'processing_not_allowed', model_calls: 0, provider: 'none_processing_not_allowed' });
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks the entire Profile when seven documents are allowed and one is denied', async () => {
    const { output, marker } = await runDeniedCase(7, 1);
    expect(output).toMatchObject({ status: 'processing_not_allowed', sample_count: 8, model_calls: 0, provider: 'none_processing_not_allowed' });
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
