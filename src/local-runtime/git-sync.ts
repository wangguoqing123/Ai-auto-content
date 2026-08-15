import path from 'node:path';
import { runCommand, type CommandResult } from './process.js';
import { assertSafeBrowserDataFile, assertSafeResearchDataFile, assertSafeTopicDataFile } from './sensitive-content.js';
import type { LocalRuntimeConfig } from './types.js';

export const AUTOMATED_DATA_PATHS = [
  'data/browser-materials',
  'data/browser-runs',
  'data/weixin-articles',
  'reports/browser',
] as const;

export const TOPIC_DATA_PATHS = [
  'data/topic-decisions',
  'data/topic-runs',
  'reports/topics',
] as const;

export const RESEARCH_DATA_PATHS = [
  'data/research-packs',
  'data/research-runs',
  'reports/research',
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
  recoveredCollectionDates: string[];
  recoveredTopicDecisionDates?: string[];
  recoveredResearchDates?: string[];
}

export interface PendingBrowserCommit {
  sha: string;
  collectionDate: string;
  files: string[];
}

export interface PendingRuntimeCommit {
  sha: string;
  task: 'morning' | 'topic_selection' | 'research_pack';
  date: string;
  files: string[];
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

function validCollectionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function assertSafeContent(file: string, content: string): void {
  try {
    if (isTopicDataPath(file)) assertSafeTopicDataFile(file, content);
    else if (isResearchDataPath(file)) assertSafeResearchDataFile(file, content);
    else assertSafeBrowserDataFile(file, content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitSyncError(message, 'invalid_staged_paths');
  }
}

export function isAutomatedDataPath(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join('/').replace(/^\.\//, '');
  if (!normalized || normalized.includes('..') || normalized === '.DS_Store' || normalized.endsWith('/.DS_Store')) return false;
  return AUTOMATED_DATA_PATHS.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

export function isTopicDataPath(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join('/').replace(/^\.\//, '');
  if (!normalized || normalized.includes('..') || normalized === '.DS_Store' || normalized.endsWith('/.DS_Store')) return false;
  return TOPIC_DATA_PATHS.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

export function isResearchDataPath(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join('/').replace(/^\.\//, '');
  if (!normalized || normalized.includes('..') || normalized === '.DS_Store' || normalized.endsWith('/.DS_Store')) return false;
  return RESEARCH_DATA_PATHS.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
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

async function assertOnlyAutomatedChanges(
  execute: Execute,
  repositoryRoot: string,
  allowed: (filePath: string) => boolean,
): Promise<void> {
  const status = await git(execute, repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const invalid = parsePorcelainPaths(status.stdout).filter((filePath) => !allowed(filePath));
  if (invalid.length > 0) throw new GitSyncError(`Refusing non-whitelisted runtime paths: ${invalid.join(', ')}`, 'invalid_staged_paths');
}

async function scanStagedContent(
  execute: Execute,
  repositoryRoot: string,
  files: string[],
  allowed: (filePath: string) => boolean,
): Promise<void> {
  for (const file of files) {
    if (!allowed(file)) throw new GitSyncError(`Invalid staged path: ${file}`, 'invalid_staged_paths');
    const shown = await git(execute, repositoryRoot, ['show', `:${file}`], true);
    if (shown.exitCode !== 0) continue;
    assertSafeContent(file, shown.stdout);
  }
}

export async function inspectPendingBrowserCommits(
  repositoryRoot: string,
  remoteRef: string,
  execute: Execute = runCommand,
): Promise<PendingBrowserCommit[]> {
  const pending = await inspectPendingRuntimeCommits(repositoryRoot, remoteRef, execute);
  if (pending.some((commit) => commit.task !== 'morning')) {
    throw new GitSyncError('Pending commits include non-Browser runtime data', 'invalid_staged_paths');
  }
  return pending.map((commit) => ({ sha: commit.sha, collectionDate: commit.date, files: commit.files }));
}

export async function inspectPendingRuntimeCommits(
  repositoryRoot: string,
  remoteRef: string,
  execute: Execute = runCommand,
): Promise<PendingRuntimeCommit[]> {
  try {
    const revisions = (await git(execute, repositoryRoot, ['rev-list', '--reverse', `${remoteRef}..HEAD`]))
      .stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const pending: PendingRuntimeCommit[] = [];
    for (const sha of revisions) {
      if (!/^[a-f0-9]{40}$/i.test(sha)) {
        throw new GitSyncError('Unable to parse pending Browser data commit SHA', 'invalid_staged_paths');
      }
      const subject = (await git(execute, repositoryRoot, ['show', '-s', '--format=%s', sha])).stdout.trim();
      const browserMatch = subject.match(/^chore\(browser-data\): collect X and WeChat (\d{4}-\d{2}-\d{2})$/);
      const topicMatch = subject.match(/^chore\(topic\): decide daily topic (\d{4}-\d{2}-\d{2})$/);
      const researchMatch = subject.match(/^chore\(research\): build evidence pack (\d{4}-\d{2}-\d{2})$/);
      const task = browserMatch ? 'morning' : topicMatch ? 'topic_selection' : researchMatch ? 'research_pack' : null;
      const date = browserMatch?.[1] ?? topicMatch?.[1] ?? researchMatch?.[1] ?? '';
      if (task === null || !validCollectionDate(date)) {
        throw new GitSyncError(`Invalid pending Runtime data commit subject: ${sha}`, 'invalid_staged_paths');
      }
      const files = parseNameList((await git(execute, repositoryRoot, [
        'diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', sha,
      ])).stdout);
      const allowed = task === 'morning' ? isAutomatedDataPath : task === 'topic_selection' ? isTopicDataPath : isResearchDataPath;
      if (files.length === 0 || files.some((file) => !allowed(file))) {
        throw new GitSyncError(`Pending commit contains non-whitelisted paths: ${sha}`, 'invalid_staged_paths');
      }
      const deleted = new Set(parseNameList((await git(execute, repositoryRoot, [
        'diff-tree', '--root', '--no-commit-id', '--name-only', '--diff-filter=D', '-r', '-z', sha,
      ])).stdout));
      for (const file of files) {
        if (deleted.has(file)) continue;
        const shown = await git(execute, repositoryRoot, ['show', `${sha}:${file}`], true);
        if (shown.exitCode !== 0) {
          throw new GitSyncError(`Unable to read pending Browser data file: ${sha}:${file}`, 'invalid_staged_paths');
        }
        assertSafeContent(file, shown.stdout);
      }
      pending.push({ sha, task, date, files });
    }
    return pending;
  } catch (error) {
    if (error instanceof GitSyncError && error.kind === 'invalid_staged_paths') throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new GitSyncError(`Unable to inspect pending Runtime data commits: ${message}`, 'invalid_staged_paths');
  }
}

function recoveredDates(pending: PendingRuntimeCommit[], task: PendingRuntimeCommit['task']): string[] {
  return [...new Set(pending.filter((commit) => commit.task === task).map((commit) => commit.date))].sort();
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
): Promise<{ commit: string; pending: PendingRuntimeCommit[] }> {
  if (fetchFirst) {
    const fetched = await git(execute, repositoryRoot, ['fetch', config.git_sync.remote, config.git_sync.branch], true);
    if (fetched.exitCode !== 0) {
      throw new GitSyncError(`Fetch failed; local data commit ${originalCommit} was preserved`, 'git_sync_failed');
    }
  }
  const remoteRef = `${config.git_sync.remote}/${config.git_sync.branch}`;
  const beforeRebase = await inspectPendingRuntimeCommits(repositoryRoot, remoteRef, execute);
  const rebase = await git(execute, repositoryRoot, ['pull', '--rebase', config.git_sync.remote, config.git_sync.branch], true);
  if (rebase.exitCode !== 0) {
    return preservedPendingCommitError(execute, repositoryRoot, originalCommit, 'Rebase failed');
  }
  const rebasedCommit = (await git(execute, repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  const afterRebase = await inspectPendingRuntimeCommits(repositoryRoot, remoteRef, execute);
  const push = await git(execute, repositoryRoot, ['push', config.git_sync.remote, config.git_sync.branch], true);
  if (push.exitCode !== 0) {
    throw new GitSyncError(`Push failed; local data commit ${rebasedCommit || originalCommit} was preserved`, 'git_sync_failed');
  }
  return { commit: rebasedCommit, pending: [...beforeRebase, ...afterRebase] };
}

export async function prepareRuntimeRepository(
  repositoryRoot: string,
  config: LocalRuntimeConfig,
  execute: Execute = runCommand,
): Promise<GitSyncResult> {
  if (!config.git_sync.enabled) return { status: 'ready', commit: null, recoveredCollectionDates: [] };
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
    const remoteRef = `${config.git_sync.remote}/${config.git_sync.branch}`;
    let pending = await inspectPendingRuntimeCommits(repositoryRoot, remoteRef, execute);
    const originalCommit = (await git(execute, repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
    let commit: string;
    if (behind > 0) {
      const recovered = await rebaseAndPushPendingCommit(execute, repositoryRoot, config, originalCommit, false);
      commit = recovered.commit;
      pending = recovered.pending;
    } else {
      const push = await git(execute, repositoryRoot, ['push', config.git_sync.remote, config.git_sync.branch], true);
      if (push.exitCode === 0) {
        commit = originalCommit;
      } else {
        const recovered = await rebaseAndPushPendingCommit(execute, repositoryRoot, config, originalCommit, true);
        commit = recovered.commit;
        pending = recovered.pending;
      }
    }
    return {
      status: 'pending_pushed',
      commit,
      recoveredCollectionDates: recoveredDates(pending, 'morning'),
      recoveredTopicDecisionDates: recoveredDates(pending, 'topic_selection'),
      recoveredResearchDates: recoveredDates(pending, 'research_pack'),
    };
  }
  if (behind > 0) await git(execute, repositoryRoot, ['merge', '--ff-only', `${config.git_sync.remote}/${config.git_sync.branch}`]);
  return { status: 'ready', commit: null, recoveredCollectionDates: [] };
}

export async function commitAndPushBrowserData(
  repositoryRoot: string,
  date: string,
  config: LocalRuntimeConfig,
  execute: Execute = runCommand,
): Promise<GitSyncResult> {
  if (!config.git_sync.enabled) return { status: 'no_changes', commit: null, recoveredCollectionDates: [] };
  await assertOnlyAutomatedChanges(execute, repositoryRoot, isAutomatedDataPath);
  for (const allowedPath of AUTOMATED_DATA_PATHS) {
    await git(execute, repositoryRoot, ['add', '-A', '--', allowedPath], true);
  }
  const staged = parseNameList((await git(execute, repositoryRoot, ['diff', '--cached', '--name-only', '-z'])).stdout);
  if (staged.length === 0) return { status: 'no_changes', commit: null, recoveredCollectionDates: [] };
  await scanStagedContent(execute, repositoryRoot, staged, isAutomatedDataPath);
  await git(execute, repositoryRoot, ['commit', '-m', `chore(browser-data): collect X and WeChat ${date}`]);
  const commit = (await git(execute, repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  const remoteRef = `${config.git_sync.remote}/${config.git_sync.branch}`;
  await inspectPendingRuntimeCommits(repositoryRoot, remoteRef, execute);
  const rebase = await git(execute, repositoryRoot, ['pull', '--rebase', config.git_sync.remote, config.git_sync.branch], true);
  if (rebase.exitCode !== 0) {
    await git(execute, repositoryRoot, ['rebase', '--abort'], true);
    throw new GitSyncError(`Rebase failed; local data commit ${commit} was preserved`, 'git_sync_failed');
  }
  await inspectPendingRuntimeCommits(repositoryRoot, remoteRef, execute);
  const push = await git(execute, repositoryRoot, ['push', config.git_sync.remote, config.git_sync.branch], true);
  if (push.exitCode !== 0) throw new GitSyncError(`Push failed; local data commit ${commit} was preserved`, 'git_sync_failed');
  const pushedCommit = (await git(execute, repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  return { status: 'pushed', commit: pushedCommit, recoveredCollectionDates: [] };
}

export async function commitAndPushTopicData(
  repositoryRoot: string,
  date: string,
  config: LocalRuntimeConfig,
  execute: Execute = runCommand,
): Promise<GitSyncResult> {
  if (!config.git_sync.enabled) return { status: 'no_changes', commit: null, recoveredCollectionDates: [], recoveredTopicDecisionDates: [] };
  await assertOnlyAutomatedChanges(execute, repositoryRoot, isTopicDataPath);
  for (const allowedPath of TOPIC_DATA_PATHS) {
    await git(execute, repositoryRoot, ['add', '-A', '--', allowedPath], true);
  }
  const staged = parseNameList((await git(execute, repositoryRoot, ['diff', '--cached', '--name-only', '-z'])).stdout);
  if (staged.length === 0) return { status: 'no_changes', commit: null, recoveredCollectionDates: [], recoveredTopicDecisionDates: [] };
  await scanStagedContent(execute, repositoryRoot, staged, isTopicDataPath);
  await git(execute, repositoryRoot, ['commit', '-m', `chore(topic): decide daily topic ${date}`]);
  const commit = (await git(execute, repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  const remoteRef = `${config.git_sync.remote}/${config.git_sync.branch}`;
  await inspectPendingRuntimeCommits(repositoryRoot, remoteRef, execute);
  const rebase = await git(execute, repositoryRoot, ['pull', '--rebase', config.git_sync.remote, config.git_sync.branch], true);
  if (rebase.exitCode !== 0) {
    await git(execute, repositoryRoot, ['rebase', '--abort'], true);
    throw new GitSyncError(`Rebase failed; local topic commit ${commit} was preserved`, 'git_sync_failed');
  }
  await inspectPendingRuntimeCommits(repositoryRoot, remoteRef, execute);
  const push = await git(execute, repositoryRoot, ['push', config.git_sync.remote, config.git_sync.branch], true);
  if (push.exitCode !== 0) throw new GitSyncError(`Push failed; local topic commit ${commit} was preserved`, 'git_sync_failed');
  const pushedCommit = (await git(execute, repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  return { status: 'pushed', commit: pushedCommit, recoveredCollectionDates: [], recoveredTopicDecisionDates: [] };
}

export async function commitAndPushResearchData(
  repositoryRoot: string,
  date: string,
  config: LocalRuntimeConfig,
  execute: Execute = runCommand,
): Promise<GitSyncResult> {
  if (!config.git_sync.enabled) return { status: 'no_changes', commit: null, recoveredCollectionDates: [], recoveredResearchDates: [] };
  await assertOnlyAutomatedChanges(execute, repositoryRoot, isResearchDataPath);
  for (const allowedPath of RESEARCH_DATA_PATHS) {
    await git(execute, repositoryRoot, ['add', '-A', '--', allowedPath], true);
  }
  const staged = parseNameList((await git(execute, repositoryRoot, ['diff', '--cached', '--name-only', '-z'])).stdout);
  if (staged.length === 0) return { status: 'no_changes', commit: null, recoveredCollectionDates: [], recoveredResearchDates: [] };
  await scanStagedContent(execute, repositoryRoot, staged, isResearchDataPath);
  await git(execute, repositoryRoot, ['commit', '-m', `chore(research): build evidence pack ${date}`]);
  const commit = (await git(execute, repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  const remoteRef = `${config.git_sync.remote}/${config.git_sync.branch}`;
  await inspectPendingRuntimeCommits(repositoryRoot, remoteRef, execute);
  const rebase = await git(execute, repositoryRoot, ['pull', '--rebase', config.git_sync.remote, config.git_sync.branch], true);
  if (rebase.exitCode !== 0) {
    await git(execute, repositoryRoot, ['rebase', '--abort'], true);
    throw new GitSyncError(`Rebase failed; local research commit ${commit} was preserved`, 'git_sync_failed');
  }
  await inspectPendingRuntimeCommits(repositoryRoot, remoteRef, execute);
  const push = await git(execute, repositoryRoot, ['push', config.git_sync.remote, config.git_sync.branch], true);
  if (push.exitCode !== 0) throw new GitSyncError(`Push failed; local research commit ${commit} was preserved`, 'git_sync_failed');
  const pushedCommit = (await git(execute, repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  return { status: 'pushed', commit: pushedCommit, recoveredCollectionDates: [], recoveredResearchDates: [] };
}
