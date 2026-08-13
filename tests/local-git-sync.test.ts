import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AUTOMATED_DATA_PATHS, commitAndPushBrowserData, GitSyncError, isAutomatedDataPath, prepareRuntimeRepository } from '../src/local-runtime/git-sync.js';
import { runCommand } from '../src/local-runtime/process.js';
import { loadLocalRuntimeConfig } from '../src/local-runtime/config.js';
import type { LocalRuntimeConfig } from '../src/local-runtime/types.js';

const roots: string[] = [];
let config: LocalRuntimeConfig;

beforeAll(async () => { config = await loadLocalRuntimeConfig(process.cwd()); });
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runCommand('git', args, { cwd, timeoutMs: 30_000 });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

async function repository(): Promise<{ root: string; remote: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'git-sync-runtime-'));
  roots.push(root);
  const remote = path.join(root, 'remote.git');
  const runtime = path.join(root, 'runtime');
  await git(root, 'init', '--bare', remote);
  await mkdir(runtime);
  await git(runtime, 'init', '-b', 'main');
  await git(runtime, 'config', 'user.name', 'Fixture');
  await git(runtime, 'config', 'user.email', 'fixture@example.com');
  await writeFile(path.join(runtime, 'README.md'), 'fixture\n');
  await git(runtime, 'add', 'README.md');
  await git(runtime, 'commit', '-m', 'fixture baseline');
  await git(runtime, 'remote', 'add', 'origin', remote);
  await git(runtime, 'push', '-u', 'origin', 'main');
  return { root: runtime, remote };
}

async function writeAllowed(root: string, text = 'safe browser report\n'): Promise<void> {
  const file = path.join(root, 'reports', 'browser', '2026-08-14.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

describe('runtime Git path and content safety', () => {
  it.each(AUTOMATED_DATA_PATHS)('allows %s and descendants', (allowed) => {
    expect(isAutomatedDataPath(`${allowed}/fixture.json`)).toBe(true);
  });

  it.each(['.DS_Store', 'data/browser-runs/.DS_Store', 'src/index.ts', 'config/project.yaml', '../outside'])('rejects %s', (file) => {
    expect(isAutomatedDataPath(file)).toBe(false);
  });

  it('commits and pushes only allowlisted Browser data', async () => {
    const repo = await repository();
    await writeAllowed(repo.root);
    const result = await commitAndPushBrowserData(repo.root, '2026-08-14', config);
    expect(result.status).toBe('pushed');
    expect(result.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(await git(repo.root, 'status', '--short')).toBe('');
  });

  it('does not create an empty commit', async () => {
    const repo = await repository();
    const before = await git(repo.root, 'rev-parse', 'HEAD');
    const result = await commitAndPushBrowserData(repo.root, '2026-08-14', config);
    expect(result.status).toBe('no_changes');
    expect(await git(repo.root, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('refuses unrelated source changes before staging', async () => {
    const repo = await repository();
    await mkdir(path.join(repo.root, 'src'));
    await writeFile(path.join(repo.root, 'src', 'unexpected.ts'), 'export {};\n');
    await expect(commitAndPushBrowserData(repo.root, '2026-08-14', config)).rejects.toMatchObject({ kind: 'invalid_staged_paths' });
  });

  it.each(['xsec_token=secret', 'pass_ticket=secret', 'Cookie: secret', 'Authorization: secret', 'ct0 secret', 'auth_token=secret', '/Users/alice/private'])('refuses sensitive staged content: %s', async (secret) => {
    const repo = await repository();
    await writeAllowed(repo.root, `${secret}\n`);
    await expect(commitAndPushBrowserData(repo.root, '2026-08-14', config)).rejects.toBeInstanceOf(GitSyncError);
  });

  it('preserves the local data commit when push fails', async () => {
    const repo = await repository();
    await writeAllowed(repo.root);
    await git(repo.root, 'remote', 'set-url', 'origin', path.join(repo.root, 'missing-remote.git'));
    await expect(commitAndPushBrowserData(repo.root, '2026-08-14', config)).rejects.toMatchObject({ kind: 'git_sync_failed' });
    expect(await git(repo.root, 'log', '-1', '--pretty=%s')).toBe('chore(browser-data): collect X and WeChat 2026-08-14');
  });

  it('aborts a conflicting rebase without force-pushing and preserves the local commit', async () => {
    const repo = await repository();
    await writeAllowed(repo.root, 'baseline report\n');
    await git(repo.root, 'add', 'reports/browser/2026-08-14.md');
    await git(repo.root, 'commit', '-m', 'add shared report');
    await git(repo.root, 'push', 'origin', 'main');
    const other = path.join(path.dirname(repo.root), 'other');
    await git(path.dirname(repo.root), 'clone', repo.remote, other);
    await git(other, 'config', 'user.name', 'Other');
    await git(other, 'config', 'user.email', 'other@example.com');
    await writeAllowed(other, 'remote edit\n');
    await git(other, 'add', 'reports/browser/2026-08-14.md');
    await git(other, 'commit', '-m', 'remote edit');
    await git(other, 'push', 'origin', 'main');
    await writeAllowed(repo.root, 'local edit\n');
    const commands: string[][] = [];
    const execute: typeof runCommand = async (command, args, options) => {
      commands.push([command, ...args]);
      return runCommand(command, args, options);
    };
    await expect(commitAndPushBrowserData(repo.root, '2026-08-14', config, execute)).rejects.toMatchObject({ kind: 'git_sync_failed' });
    expect(commands.flat().join(' ')).not.toContain('--force');
    expect(await git(repo.root, 'log', '-1', '--pretty=%s')).toBe('chore(browser-data): collect X and WeChat 2026-08-14');
    expect(await git(repo.root, 'status', '--short')).toBe('');
  });

  it('pushes a pending local commit first and tells the caller not to recollect', async () => {
    const repo = await repository();
    await writeAllowed(repo.root);
    await git(repo.root, 'add', 'reports/browser/2026-08-14.md');
    await git(repo.root, 'commit', '-m', 'pending browser data');
    const result = await prepareRuntimeRepository(repo.root, config);
    expect(result).toMatchObject({ status: 'pending_pushed', skipCollection: true });
    expect(await git(repo.root, 'rev-list', '--count', 'origin/main..HEAD')).toBe('0');
  });
});
