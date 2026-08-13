import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OpenCliRunner } from '../collectors/opencli/opencli-runner.js';
import { runCommand, type CommandResult } from './process.js';
import type { LocalRuntimeConfig } from './types.js';

export type HealthStatus = 'success' | 'failed' | 'unavailable' | 'login_required' | 'blocked';

export interface HealthCheckItem {
  name: string;
  ok: boolean;
  detail: string;
}

export interface HealthCheckResult {
  status: HealthStatus;
  checks: HealthCheckItem[];
  error: string | null;
}

export interface HealthCheckDependencies {
  execute?: typeof runCommand;
  openCliRunner?: OpenCliRunner;
  homeDirectory?: string;
  platformProbes?: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
}

function commandOk(result: CommandResult): boolean {
  return result.exitCode === 0 && !result.timedOut;
}

function doctorLineOk(text: string, label: string): boolean {
  const line = text.split(/\r?\n/).find((candidate) => candidate.toLocaleLowerCase().includes(label.toLocaleLowerCase()));
  if (!line || /not connected|failed|unavailable|not running|✗|×/i.test(line)) return false;
  return /\bok\b|connected|running|healthy|ready|✓|✔/i.test(line);
}

export function parseDoctorOutput(text: string): { daemon: boolean; extension: boolean; connectivity: boolean } {
  return {
    daemon: doctorLineOk(text, 'daemon'),
    extension: doctorLineOk(text, 'extension'),
    connectivity: doctorLineOk(text, 'connectivity'),
  };
}

function versionCompatible(text: string): boolean {
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [major, minor, patchVersion] = match.slice(1).map(Number);
  return major === 1 && ((minor ?? 0) > 8 || ((minor ?? 0) === 8 && (patchVersion ?? 0) >= 6));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function failureStatus(statuses: HealthStatus[]): HealthStatus {
  for (const status of ['blocked', 'login_required', 'unavailable', 'failed'] as const) {
    if (statuses.includes(status)) return status;
  }
  return 'success';
}

function healthStatusFromOpenCli(status: 'success' | 'partial_success' | 'login_required' | 'blocked' | 'unavailable' | 'command_failed'): HealthStatus {
  if (status === 'login_required' || status === 'blocked' || status === 'unavailable') return status;
  return status === 'success' ? 'success' : 'failed';
}

export async function runHealthCheck(
  config: LocalRuntimeConfig,
  dependencies: HealthCheckDependencies = {},
): Promise<HealthCheckResult> {
  const execute = dependencies.execute ?? runCommand;
  const runner = dependencies.openCliRunner ?? new OpenCliRunner();
  const homeDirectory = dependencies.homeDirectory ?? os.homedir();
  const checks: HealthCheckItem[] = [];
  const statuses: HealthStatus[] = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'node', ok: nodeMajor >= 20, detail: `v${process.versions.node}` });
  if (nodeMajor < 20) statuses.push('failed');

  const npm = await execute('npm', ['--version'], { timeoutMs: 5_000 });
  checks.push({ name: 'npm', ok: commandOk(npm), detail: commandOk(npm) ? npm.stdout.trim() : 'not available' });
  if (!commandOk(npm)) statuses.push('unavailable');

  const opencli = await execute('opencli', ['--version'], { timeoutMs: 5_000 });
  const opencliOk = commandOk(opencli) && versionCompatible(`${opencli.stdout}\n${opencli.stderr}`);
  checks.push({ name: 'opencli', ok: opencliOk, detail: opencliOk ? opencli.stdout.trim() : 'requires compatible 1.x >= 1.8.6' });
  if (!opencliOk) statuses.push('unavailable');

  const adapterPaths = [
    path.join(homeDirectory, '.opencli', 'clis', 'twitter', 'search-rich.js'),
    path.join(homeDirectory, '.opencli', 'clis', 'weixin', 'resolve-article-url.js'),
  ];
  const adaptersOk = (await Promise.all(adapterPaths.map(fileExists))).every(Boolean);
  checks.push({ name: 'project_adapters', ok: adaptersOk, detail: adaptersOk ? 'installed' : 'run npm run opencli:install-adapters during setup' });
  if (!adaptersOk) statuses.push('unavailable');

  let chrome = await execute('/usr/bin/pgrep', ['-x', 'Google Chrome'], { timeoutMs: 5_000 });
  if (!commandOk(chrome) && config.runtime.auto_launch_chrome && process.platform === 'darwin') {
    const launched = await execute('/usr/bin/open', ['-a', 'Google Chrome'], { timeoutMs: 5_000 });
    if (commandOk(launched)) {
      await (dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(
        config.runtime.chrome_startup_wait_seconds * 1_000,
      );
      chrome = await execute('/usr/bin/pgrep', ['-x', 'Google Chrome'], { timeoutMs: 5_000 });
    }
  }
  checks.push({ name: 'chrome', ok: commandOk(chrome), detail: commandOk(chrome) ? 'running' : 'not running' });
  if (!commandOk(chrome)) statuses.push('unavailable');

  if (statuses.length > 0) {
    const status = failureStatus(statuses);
    return { status, checks, error: checks.filter((check) => !check.ok).map((check) => check.name).join(', ') };
  }

  const doctorResult = await runner.run(['doctor'], { parseJson: false, timeoutMs: 15_000 });
  const doctor = parseDoctorOutput(`${doctorResult.stdout}\n${doctorResult.stderr}`);
  for (const [name, ok] of Object.entries(doctor)) checks.push({ name: `opencli_${name}`, ok, detail: ok ? 'OK' : 'not OK' });
  if (doctorResult.status !== 'success' || !doctor.daemon || !doctor.extension || !doctor.connectivity) {
    return { status: 'unavailable', checks, error: 'OpenCLI daemon, Extension, or Connectivity is not ready' };
  }

  if (dependencies.platformProbes !== false) {
    const twitter = await runner.run([
      'twitter', 'search', 'AI', '--product', 'live', '--limit', '1', '-f', 'json',
    ], { timeoutMs: 30_000 });
    checks.push({ name: 'x_login', ok: twitter.status === 'success', detail: twitter.status });
    if (twitter.status !== 'success') statuses.push(healthStatusFromOpenCli(twitter.status));
    if (twitter.status === 'success') {
      const weixin = await runner.run([
        'weixin', 'search', 'AI', '--page', '1', '--limit', '1', '-f', 'json',
      ], { timeoutMs: 30_000 });
      checks.push({ name: 'weixin_public_search', ok: weixin.status === 'success', detail: weixin.status });
      if (weixin.status !== 'success') statuses.push(healthStatusFromOpenCli(weixin.status));
    }
  }

  const status = failureStatus(statuses);
  return {
    status,
    checks,
    error: status === 'success' ? null : checks.filter((check) => !check.ok).map((check) => `${check.name}:${check.detail}`).join(', '),
  };
}
