import os from 'node:os';
import path from 'node:path';
import { runCommand, type CommandResult } from './process.js';
import type { LocalRuntimeConfig } from './types.js';

export const AUTOMATED_DATA_PATHS = [
  'data/browser-materials',
  'data/browser-runs',
  'data/weixin-articles',
  'reports/browser',
] as const;

export class GitSyncError extends Error {
  constructor(message: string, readonly kind: 'git_sync_failed' | 'invalid_staged_paths') {
    super(message);
    this.name = 'GitSyncError';
  }
}

export interface GitSyncResult {
  status: 'ready' | 'pending_pushed' | 'no_changes' | 'pushed';
  commit: string | null;
  skipCollection: boolean;
}

type Execute = typeof runCommand;

function failure(result: CommandResult): string {
  return (result.stderr || result.stdout || `${result.command} failed`).replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function git(execute: Execute, root: string, args: readonly string[], allowFailure = false): Promise<CommandResult> {
  const result = await execute('git', args, { cwd: root, timeoutMs: 60_000 });
  if (!allowFailure && result.exitCode !== 0) throw new GitSyncError(failure(result), 'git_sync_failed');
  return result;
}

function parseNameList(value: string): string[] {
  return value.split('\0').filter(Boolean);
}

export function isAutomatedDataPath(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join('/').replace(/^\.\//, '');
  if (!normalized || normalized.includes('..') || normalized === '.DS_Store' || normalized.endsWith('/.DS_Store')) return false;
  return AUTOMATED_DATA_PATHS.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function parsePorcelainPaths(output: string): string[] {
  const records = output.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? '';
    const status = record.slice(0, 2);
    const filePath = record.slice(3);
    paths.push(filePath);
    if ((status.includes('R') || status.includes('C')) && records[index + 1]) {
      paths.push(records[index + 1] ?? '');
      index += 1;
    }
  }
  return paths;
}

async function assertOnlyAutomatedChanges(execute: Execute, repositoryRoot: string): Promise<void> {
  const status = await git(execute, repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const invalid = parsePorcelainPaths(status.stdout).filter((filePath) => !isAutomatedDataPath(filePath));
  if (invalid.length > 0) throw new GitSyncError(`Refusing non-whitelisted runtime paths: ${invalid.join(', ')}`, 'invalid_staged_paths');
}

async function scanStagedContent(execute: Execute, repositoryRoot: string, files: string[]): Promise<void> {
  const homeDirectory = os.homedir();
  const sensitive = /[?&](?:signature|pass_ticket|exportkey|sessionid|xsec_token)=|\bCookie:|\bAuthorization:|\bct0\b|auth_token|\.DS_Store/i;
  for (const file of files) {
    if (!isAutomatedDataPath(file)) throw new GitSyncError(`Invalid staged path: ${file}`, 'invalid_staged_paths');
    const shown = await git(execute, repositoryRoot, ['show', `:${file}`], true);
    if (shown.exitCode !== 0) continue;
    if (sensitive.test(shown.stdout) || shown.stdout.includes(homeDirectory) || /\/Users\/[^/\s]+\//.test(shown.stdout)) {
      throw new GitSyncError(`Sensitive content detected in staged file: ${file}`, 'invalid_staged_paths');
    }
  }
}

async function preservedPendingCommitError(
  execute: Execute,
  repositoryRoot: string,
  originalCommit: string,
  message: string,
): Promise<never> {
  await git(execute, repositoryRoot, ['rebase', '--abort'], true);
  throw new GitSyncError(`${message}; local data commit ${originalCommit} was preserved`, 'git_sync_failed');
}

async function rebaseAndPushPendingCommit(
  execute: Execute,
  repositoryRoot: string,
  config: LocalRuntimeConfig,
  originalCommit: string,
  fetchFirst: boolean,
): Promise<string> {
  if (fetchFirst) {
    const fetched = await git(execute, repositoryRoot, ['fetch', config.git_sync.remote, config.git_sync.branch], true);
    if (fetched.exitCode !== 0) {
      throw new GitSyncError(`Fetch failed; local data commit ${originalCommit} was preserved`, 'git_sync_failed');
    }
  }
  const rebase = await git(execute, repositoryRoot, ['pull', '--rebase', config.git_sync.remote, config.git_sync.branch], true);
  if (rebase.exitCode !== 0) {
    return preservedPendingCommitError(execute, repositoryRoot, originalCommit, 'Rebase failed');
  }
  const rebasedCommit = (await git(execute, repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  const push = await git(execute, repositoryRoot, ['push', config.git_sync.remote, config.git_sync.branch], true);
  if (push.exitCode !== 0) {
    throw new GitSyncError(`Push failed; local data commit ${rebasedCommit || originalCommit} was preserved`, 'git_sync_failed');
  }
  return rebasedCommit;
}

export async function prepareRuntimeRepository(
  repositoryRoot: string,
  config: LocalRuntimeConfig,
  execute: Execute = runCommand,
): Promise<GitSyncResult> {
  if (!config.git_sync.enabled) return { status: 'ready', commit: null, skipCollection: false };
  const branch = (await git(execute, repositoryRoot, ['branch', '--show-current'])).stdout.trim();
  if (branch !== config.git_sync.branch) {
    throw new GitSyncError(`Runtime repository must be on ${config.git_sync.branch}; found ${branch || 'detached HEAD'}`, 'git_sync_failed');
  }
  const status = await git(execute, repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (status.stdout) throw new GitSyncError('Runtime repository has uncommitted changes; refusing automatic sync', 'invalid_staged_paths');
  await git(execute, repositoryRoot, ['fetch', config.git_sync.remote, config.git_sync.branch]);
  const counts = (await git(execute, repositoryRoot, [
    'rev-list', '--left-right', '--count', `${config.git_sync.remote}/${config.git_sync.branch}...HEAD`,
  ])).stdout.trim().split(/\s+/).map(Number);
  const behind = counts[0] ?? 0;
  const ahead = counts[1] ?? 0;
  if (ahead > 0) {
    const originalCommit = (await git(execute, repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
    let commit: string;
    if (behind > 0) {
      commit = await rebaseAndPushPendingCommit(execute, repositoryRoot, config, originalCommit, false);
    } else {
      const push = await git(execute, repositoryRoot, ['push', config.git_sync.remote, config.git_sync.branch], true);
      commit = push.exitCode === 0
        ? originalCommit
        : await rebaseAndPushPendingCommit(execute, repositoryRoot, config, originalCommit, true);
    }
    return { status: 'pending_pushed', commit, skipCollection: true };
  }
  if (behind > 0) await git(execute, repositoryRoot, ['merge', '--ff-only', `${config.git_sync.remote}/${config.git_sync.branch}`]);
  return { status: 'ready', commit: null, skipCollection: false };
}

export async function commitAndPushBrowserData(
  repositoryRoot: string,
  date: string,
  config: LocalRuntimeConfig,
  execute: Execute = runCommand,
): Promise<GitSyncResult> {
  if (!config.git_sync.enabled) return { status: 'no_changes', commit: null, skipCollection: false };
  await assertOnlyAutomatedChanges(execute, repositoryRoot);
  for (const allowedPath of AUTOMATED_DATA_PATHS) {
    await git(execute, repositoryRoot, ['add', '-A', '--', allowedPath], true);
  }
  const staged = parseNameList((await git(execute, repositoryRoot, ['diff', '--cached', '--name-only', '-z'])).stdout);
  if (staged.length === 0) return { status: 'no_changes', commit: null, skipCollection: false };
  await scanStagedContent(execute, repositoryRoot, staged);
  await git(execute, repositoryRoot, ['commit', '-m', `chore(browser-data): collect X and WeChat ${date}`]);
  const commit = (await git(execute, repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  const rebase = await git(execute, repositoryRoot, ['pull', '--rebase', config.git_sync.remote, config.git_sync.branch], true);
  if (rebase.exitCode !== 0) {
    await git(execute, repositoryRoot, ['rebase', '--abort'], true);
    throw new GitSyncError(`Rebase failed; local data commit ${commit} was preserved`, 'git_sync_failed');
  }
  const push = await git(execute, repositoryRoot, ['push', config.git_sync.remote, config.git_sync.branch], true);
  if (push.exitCode !== 0) throw new GitSyncError(`Push failed; local data commit ${commit} was preserved`, 'git_sync_failed');
  return { status: 'pushed', commit, skipCollection: false };
}
