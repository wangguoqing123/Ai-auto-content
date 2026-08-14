import { constants as fsConstants } from 'node:fs';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from './process.js';
import { createRuntimePaths } from './paths.js';
import type { RuntimePaths } from './types.js';

const LABEL = 'com.ai-auto-content.local-scheduler';

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export interface LaunchdValues {
  wrapperPath: string;
  nodePath: string;
  opencliPath: string;
  codexPath: string;
  codexModel: string;
  runtimeRoot: string;
  stdoutPath: string;
  stderrPath: string;
}

export async function renderLaunchdPlist(templatePath: string, values: LaunchdValues): Promise<string> {
  const replacements: Record<string, string> = {
    WRAPPER_PATH: values.wrapperPath,
    NODE_PATH: values.nodePath,
    OPENCLI_PATH: values.opencliPath,
    CODEX_PATH: values.codexPath,
    CODEX_MODEL: values.codexModel,
    RUNTIME_ROOT: values.runtimeRoot,
    STDOUT_PATH: values.stdoutPath,
    STDERR_PATH: values.stderrPath,
  };
  let rendered = await readFile(templatePath, 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    if (key !== 'CODEX_MODEL' && !path.isAbsolute(value)) throw new Error(`${key} must be an absolute path`);
    if (key === 'CODEX_MODEL' && (!value || /[\r\n\0]/.test(value))) throw new Error('CODEX_MODEL is invalid');
    rendered = rendered.replaceAll(`{{${key}}}`, xmlEscape(value));
  }
  if (/{{[A-Z_]+}}/.test(rendered)) throw new Error('LaunchAgent template contains unresolved placeholders');
  if (/(?:auth_token|pass_ticket|Cookie:|Authorization:|github_pat_|ghp_)/i.test(rendered)) {
    throw new Error('LaunchAgent template contains a forbidden secret marker');
  }
  return rendered;
}

async function resolveExecutable(name: string): Promise<string | null> {
  const result = await runCommand('/usr/bin/which', [name], { timeoutMs: 5_000 });
  const candidate = result.exitCode === 0 ? result.stdout.trim() : '';
  if (!candidate || !path.isAbsolute(candidate)) return null;
  try {
    await access(candidate, fsConstants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

async function validatePlist(filePath: string): Promise<void> {
  if (process.platform !== 'darwin') return;
  const lint = await runCommand('/usr/bin/plutil', ['-lint', filePath], { timeoutMs: 5_000 });
  if (lint.exitCode !== 0) throw new Error((lint.stderr || lint.stdout).trim() || 'plutil validation failed');
}

export interface InstallResult {
  mode: 'dry-run' | 'installed';
  launchAgentFile: string;
  runtimeRoot: string;
  missingPrerequisites: string[];
  backupFile: string | null;
  plistValidated: boolean;
}

async function renderToTemporary(
  repositoryRoot: string,
  paths: RuntimePaths,
  nodePath: string,
  opencliPath: string,
  codexPath: string,
  codexModel: string,
): Promise<{ directory: string; file: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ai-auto-content-launchd-'));
  const file = path.join(directory, `${LABEL}.plist`);
  const rendered = await renderLaunchdPlist(
    path.join(repositoryRoot, 'launchd', `${LABEL}.plist.template`),
    {
      wrapperPath: path.join(paths.runtimeRoot, 'scripts', 'local-scheduler-wrapper.sh'),
      nodePath,
      opencliPath,
      codexPath,
      codexModel,
      runtimeRoot: paths.runtimeRoot,
      stdoutPath: path.join(paths.logsDirectory, 'scheduler.stdout.log'),
      stderrPath: path.join(paths.logsDirectory, 'scheduler.stderr.log'),
    },
  );
  await writeFile(file, rendered, 'utf8');
  await validatePlist(file);
  return { directory, file };
}

export async function installLocalRuntime(
  repositoryRoot: string,
  install: boolean,
  paths = createRuntimePaths(),
): Promise<InstallResult> {
  const nodePath = process.execPath;
  const npmPath = await resolveExecutable('npm');
  const opencliPath = await resolveExecutable('opencli');
  const configuredCodex = process.env.TOPIC_CODEX_BIN?.trim();
  let codexPath: string | null = null;
  if (configuredCodex && path.isAbsolute(configuredCodex)) {
    try {
      await access(configuredCodex, fsConstants.X_OK);
      codexPath = configuredCodex;
    } catch {
      codexPath = null;
    }
  } else if (!configuredCodex) {
    codexPath = await resolveExecutable('codex');
  }
  const codexModel = process.env.TOPIC_CODEX_MODEL?.trim() ?? '';
  const missingPrerequisites = [
    !npmPath && 'npm',
    !opencliPath && 'opencli',
    !codexPath && 'codex',
    !codexModel && 'TOPIC_CODEX_MODEL',
  ].filter((value): value is string => Boolean(value));
  const temporary = await renderToTemporary(
    repositoryRoot,
    paths,
    nodePath,
    opencliPath ?? '/usr/local/bin/opencli',
    codexPath ?? '/usr/local/bin/codex',
    codexModel || 'codex-model-required',
  );
  let backupFile: string | null = null;
  try {
    if (!install) {
      return {
        mode: 'dry-run',
        launchAgentFile: paths.launchAgentFile,
        runtimeRoot: paths.runtimeRoot,
        missingPrerequisites,
        backupFile: null,
        plistValidated: true,
      };
    }
    if (process.platform !== 'darwin') throw new Error('LaunchAgent installation is only supported on macOS');
    if (missingPrerequisites.length > 0 || !npmPath || !opencliPath || !codexPath || !codexModel) {
      throw new Error(`Missing installer prerequisites: ${missingPrerequisites.join(', ')}`);
    }

    await Promise.all([
      mkdir(paths.supportRoot, { recursive: true }),
      mkdir(paths.stateDirectory, { recursive: true }),
      mkdir(path.dirname(paths.lockDirectory), { recursive: true }),
      mkdir(paths.configDirectory, { recursive: true }),
      mkdir(paths.logsDirectory, { recursive: true }),
      mkdir(paths.launchAgentsDirectory, { recursive: true }),
    ]);

    try {
      await access(path.join(paths.runtimeRoot, '.git'));
      const branch = await runCommand('git', ['branch', '--show-current'], { cwd: paths.runtimeRoot });
      if (branch.exitCode !== 0 || branch.stdout.trim() !== 'main') throw new Error('Existing Runtime clone is not on main');
      const pull = await runCommand('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: paths.runtimeRoot, timeoutMs: 60_000 });
      if (pull.exitCode !== 0) throw new Error((pull.stderr || pull.stdout).trim() || 'Runtime clone update failed');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const remote = await runCommand('git', ['remote', 'get-url', 'origin'], { cwd: repositoryRoot });
      if (remote.exitCode !== 0) throw new Error('Unable to resolve origin for Runtime clone');
      const clone = await runCommand('git', [
        'clone', '--branch', 'main', '--single-branch', remote.stdout.trim(), paths.runtimeRoot,
      ], { timeoutMs: 120_000 });
      if (clone.exitCode !== 0) throw new Error((clone.stderr || clone.stdout).trim() || 'Runtime clone failed');
    }
    const npmInstall = await runCommand(npmPath, ['ci'], { cwd: paths.runtimeRoot, timeoutMs: 120_000 });
    if (npmInstall.exitCode !== 0) throw new Error((npmInstall.stderr || npmInstall.stdout).trim() || 'npm ci failed in Runtime clone');
    await chmod(path.join(paths.runtimeRoot, 'scripts', 'local-scheduler-wrapper.sh'), 0o755);
    try {
      await access(paths.configFile);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      await copyFile(path.join(paths.runtimeRoot, 'config', 'local-runtime.yaml'), paths.configFile);
    }

    try {
      await access(paths.launchAgentFile);
      backupFile = `${paths.launchAgentFile}.backup-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
      await copyFile(paths.launchAgentFile, backupFile);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const destinationTemporary = `${paths.launchAgentFile}.tmp-${process.pid}`;
    await copyFile(temporary.file, destinationTemporary);
    await validatePlist(destinationTemporary);
    await rename(destinationTemporary, paths.launchAgentFile);
    const domain = `gui/${process.getuid?.() ?? os.userInfo().uid}`;
    await runCommand('/bin/launchctl', ['bootout', domain, paths.launchAgentFile], { timeoutMs: 10_000 });
    const bootstrap = await runCommand('/bin/launchctl', ['bootstrap', domain, paths.launchAgentFile], { timeoutMs: 10_000 });
    if (bootstrap.exitCode !== 0) throw new Error((bootstrap.stderr || bootstrap.stdout).trim() || 'launchctl bootstrap failed');
    return {
      mode: 'installed',
      launchAgentFile: paths.launchAgentFile,
      runtimeRoot: paths.runtimeRoot,
      missingPrerequisites: [],
      backupFile,
      plistValidated: true,
    };
  } finally {
    await rm(temporary.directory, { recursive: true, force: true });
  }
}

export async function uninstallLocalRuntime(
  uninstall: boolean,
  paths = createRuntimePaths(),
): Promise<{ mode: 'dry-run' | 'uninstalled'; launchAgentFile: string; runtimePreserved: true }> {
  if (!uninstall) return { mode: 'dry-run', launchAgentFile: paths.launchAgentFile, runtimePreserved: true };
  if (process.platform !== 'darwin') throw new Error('LaunchAgent uninstall is only supported on macOS');
  const domain = `gui/${process.getuid?.() ?? os.userInfo().uid}`;
  await runCommand('/bin/launchctl', ['bootout', domain, paths.launchAgentFile], { timeoutMs: 10_000 });
  await rm(paths.launchAgentFile, { force: true });
  return { mode: 'uninstalled', launchAgentFile: paths.launchAgentFile, runtimePreserved: true };
}
