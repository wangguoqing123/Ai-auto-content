import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AUTOMATED_DATA_PATHS,
  commitAndPushBrowserData,
  GitSyncError,
  inspectPendingBrowserCommits,
  isAutomatedDataPath,
  prepareRuntimeRepository,
} from '../src/local-runtime/git-sync.js';
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
  await git(root, 'init', '--bare', '--initial-branch=main', remote);
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

async function commitBrowserData(root: string, date: string, message?: string): Promise<string> {
  await git(root, 'add', '-A', '--', 'reports/browser');
  await git(root, 'commit', '-m', message ?? `chore(browser-data): collect X and WeChat ${date}`);
  return git(root, 'rev-parse', 'HEAD');
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

  it.each([
    'https://example.com/?xsec_token=secret',
    'https://example.com/?signature=secret',
    'https://example.com/?pass_ticket=secret',
    'https://example.com/?exportkey=secret',
    'https://example.com/?sessionid=secret',
    'Cookie: secret',
    'Authorization: secret',
    'ct0 secret',
    'auth_token=secret',
    '/Users/alice/private',
  ])('refuses sensitive staged content: %s', async (secret) => {
    const repo = await repository();
    await writeAllowed(repo.root, `${secret}\n`);
    await expect(commitAndPushBrowserData(repo.root, '2026-08-14', config)).rejects.toBeInstanceOf(GitSyncError);
  });

  it('does not treat the normal word signature as sensitive staged content', async () => {
    const repo = await repository();
    await writeAllowed(repo.root, 'A document signature can be useful.\n');
    await expect(commitAndPushBrowserData(repo.root, '2026-08-14', config)).resolves.toMatchObject({ status: 'pushed' });
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

  it('inspects and pushes a valid pending Browser data commit with its collection date', async () => {
    const repo = await repository();
    await writeAllowed(repo.root);
    await commitBrowserData(repo.root, '2026-08-14');
    await expect(inspectPendingBrowserCommits(repo.root, 'origin/main')).resolves.toMatchObject([{
      collectionDate: '2026-08-14', files: ['reports/browser/2026-08-14.md'],
    }]);
    const result = await prepareRuntimeRepository(repo.root, config);
    expect(result).toMatchObject({ status: 'pending_pushed', recoveredCollectionDates: ['2026-08-14'] });
    expect(await git(repo.root, 'rev-list', '--count', 'origin/main..HEAD')).toBe('0');
  });

  it('rebases a pending commit over a remote advance, pushes both commits, and skips collection', async () => {
    const repo = await repository();
    const other = path.join(path.dirname(repo.root), 'other-diverged');
    await git(path.dirname(repo.root), 'clone', repo.remote, other);
    await git(other, 'config', 'user.name', 'Other');
    await git(other, 'config', 'user.email', 'other@example.com');

    await writeAllowed(repo.root, 'pending local report\n');
    const originalCommit = await commitBrowserData(repo.root, '2026-08-14');

    await writeFile(path.join(other, 'remote.txt'), 'remote advance\n');
    await git(other, 'add', 'remote.txt');
    await git(other, 'commit', '-m', 'remote advance');
    await git(other, 'push', 'origin', 'main');

    const result = await prepareRuntimeRepository(repo.root, config);
    expect(result).toMatchObject({ status: 'pending_pushed', recoveredCollectionDates: ['2026-08-14'] });
    expect(result.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(result.commit).not.toBe(originalCommit);
    await git(repo.root, 'fetch', 'origin', 'main');
    expect(await git(repo.root, 'rev-list', '--count', 'origin/main..HEAD')).toBe('0');
    const subjects = await git(repo.root, 'log', '--format=%s', '-3', 'origin/main');
    expect(subjects).toContain('chore(browser-data): collect X and WeChat 2026-08-14');
    expect(subjects).toContain('remote advance');
  });

  it('aborts a conflicting prepare rebase and preserves the pending local commit', async () => {
    const repo = await repository();
    await writeAllowed(repo.root, 'shared baseline\n');
    await git(repo.root, 'add', 'reports/browser/2026-08-14.md');
    await git(repo.root, 'commit', '-m', 'shared report');
    await git(repo.root, 'push', 'origin', 'main');
    const other = path.join(path.dirname(repo.root), 'other-conflict');
    await git(path.dirname(repo.root), 'clone', repo.remote, other);
    await git(other, 'config', 'user.name', 'Other');
    await git(other, 'config', 'user.email', 'other@example.com');

    await writeAllowed(repo.root, 'pending local edit\n');
    const pendingCommit = await commitBrowserData(repo.root, '2026-08-14');

    await writeAllowed(other, 'remote conflicting edit\n');
    await git(other, 'add', 'reports/browser/2026-08-14.md');
    await git(other, 'commit', '-m', 'remote conflicting edit');
    await git(other, 'push', 'origin', 'main');
    const commands: string[][] = [];
    const execute: typeof runCommand = async (command, args, options) => {
      commands.push([command, ...args]);
      return runCommand(command, args, options);
    };

    await expect(prepareRuntimeRepository(repo.root, config, execute)).rejects.toMatchObject({ kind: 'git_sync_failed' });
    expect(commands.flat().join(' ')).not.toContain('--force');
    expect(await git(repo.root, 'rev-parse', 'HEAD')).toBe(pendingCommit);
    expect(await git(repo.root, 'status', '--short')).toBe('');
  });

  it('recovers once when the remote advances between initial fetch and pending push', async () => {
    const repo = await repository();
    const other = path.join(path.dirname(repo.root), 'other-race');
    await git(path.dirname(repo.root), 'clone', repo.remote, other);
    await git(other, 'config', 'user.name', 'Other');
    await git(other, 'config', 'user.email', 'other@example.com');
    await writeAllowed(repo.root, 'pending race report\n');
    await commitBrowserData(repo.root, '2026-08-14');
    let injectedRace = false;
    let pushAttempts = 0;
    const execute: typeof runCommand = async (command, args, options) => {
      if (command === 'git' && args[0] === 'push') {
        pushAttempts += 1;
        if (!injectedRace) {
          injectedRace = true;
          await writeFile(path.join(other, 'race.txt'), 'racing remote commit\n');
          await git(other, 'add', 'race.txt');
          await git(other, 'commit', '-m', 'racing remote advance');
          await git(other, 'push', 'origin', 'main');
        }
      }
      return runCommand(command, args, options);
    };

    const result = await prepareRuntimeRepository(repo.root, config, execute);
    expect(result).toMatchObject({ status: 'pending_pushed', recoveredCollectionDates: ['2026-08-14'] });
    expect(pushAttempts).toBe(2);
    const subjects = await git(repo.root, 'log', '--format=%s', '-3');
    expect(subjects).toContain('chore(browser-data): collect X and WeChat 2026-08-14');
    expect(subjects).toContain('racing remote advance');
  });

  it('recovers multiple valid Browser data commits and carries every collection date', async () => {
    const repo = await repository();
    await writeAllowed(repo.root, 'first date\n');
    await commitBrowserData(repo.root, '2026-08-14');
    const second = path.join(repo.root, 'reports', 'browser', '2026-08-15.md');
    await writeFile(second, 'second date\n');
    await commitBrowserData(repo.root, '2026-08-15');
    await expect(prepareRuntimeRepository(repo.root, config)).resolves.toMatchObject({
      status: 'pending_pushed', recoveredCollectionDates: ['2026-08-14', '2026-08-15'],
    });
  });

  it('allows a valid pending commit to delete an allowlisted Browser data file', async () => {
    const repo = await repository();
    await writeAllowed(repo.root, 'obsolete report\n');
    await git(repo.root, 'add', 'reports/browser/2026-08-14.md');
    await git(repo.root, 'commit', '-m', 'fixture report baseline');
    await git(repo.root, 'push', 'origin', 'main');
    await rm(path.join(repo.root, 'reports', 'browser', '2026-08-14.md'));
    await commitBrowserData(repo.root, '2026-08-14');
    await expect(prepareRuntimeRepository(repo.root, config)).resolves.toMatchObject({
      status: 'pending_pushed', recoveredCollectionDates: ['2026-08-14'],
    });
  });

  it.each([
    ['source path', async (root: string) => {
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(path.join(root, 'src', 'index.ts'), 'export {};\n');
      await git(root, 'add', 'src/index.ts');
      await git(root, 'commit', '-m', 'chore(browser-data): collect X and WeChat 2026-08-14');
    }],
    ['config path', async (root: string) => {
      await mkdir(path.join(root, 'config'), { recursive: true });
      await writeFile(path.join(root, 'config', 'project.yaml'), 'unsafe: true\n');
      await git(root, 'add', 'config/project.yaml');
      await git(root, 'commit', '-m', 'chore(browser-data): collect X and WeChat 2026-08-14');
    }],
    ['temporary signature URL', async (root: string) => {
      await writeAllowed(root, 'https://mp.weixin.qq.com/s?signature=secret\n');
      await commitBrowserData(root, '2026-08-14');
    }],
    ['authentication content', async (root: string) => {
      await writeAllowed(root, 'Cookie secret; Authorization bearer-value\n');
      await commitBrowserData(root, '2026-08-14');
    }],
    ['local absolute path', async (root: string) => {
      await writeAllowed(root, '/Users/alice/runtime/private.md\n');
      await commitBrowserData(root, '2026-08-14');
    }],
    ['invalid subject', async (root: string) => {
      await writeAllowed(root);
      await commitBrowserData(root, '2026-08-14', 'pending browser data');
    }],
    ['invalid date', async (root: string) => {
      await writeAllowed(root);
      await commitBrowserData(root, '2026-02-30', 'chore(browser-data): collect X and WeChat 2026-02-30');
    }],
  ] as const)('refuses unsafe pending commit: %s', async (_label, arrange) => {
    const repo = await repository();
    await arrange(repo.root);
    const pendingCommit = await git(repo.root, 'rev-parse', 'HEAD');
    const commands: string[][] = [];
    const execute: typeof runCommand = async (command, args, options) => {
      commands.push([command, ...args]);
      return runCommand(command, args, options);
    };
    await expect(prepareRuntimeRepository(repo.root, config, execute)).rejects.toMatchObject({ kind: 'invalid_staged_paths' });
    expect(commands.some((command) => command.includes('push'))).toBe(false);
    expect(commands.flat().join(' ')).not.toContain('--force');
    expect(await git(repo.root, 'rev-parse', 'HEAD')).toBe(pendingCommit);
  });
});
