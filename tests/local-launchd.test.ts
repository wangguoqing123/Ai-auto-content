import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installLocalRuntime, renderLaunchdPlist, uninstallLocalRuntime } from '../src/local-runtime/launchd.js';
import { createRuntimePaths } from '../src/local-runtime/paths.js';

const roots: string[] = [];
const template = path.join(process.cwd(), 'launchd', 'com.ai-auto-content.local-scheduler.plist.template');

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function values(root: string) {
  return {
    wrapperPath: path.join(root, 'runtime/scripts/local-scheduler-wrapper.sh'),
    nodePath: '/usr/local/bin/node',
    opencliPath: '/usr/local/bin/opencli',
    codexPath: '/usr/local/bin/codex',
    codexModel: 'fixture-codex-model',
    runtimeRoot: path.join(root, 'runtime'),
    stdoutPath: path.join(root, 'logs/stdout.log'),
    stderrPath: path.join(root, 'logs/stderr.log'),
  };
}

describe('LaunchAgent rendering and dry-run safety', () => {
  it('renders the required label, interval, and RunAtLoad', async () => {
    const rendered = await renderLaunchdPlist(template, values('/tmp/ai-auto-content'));
    expect(rendered).toContain('<string>com.ai-auto-content.local-scheduler</string>');
    expect(rendered).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(rendered).toContain('<integer>900</integer>');
  });

  it('uses absolute rendered program and working paths', async () => {
    const rendered = await renderLaunchdPlist(template, values('/tmp/ai-auto-content'));
    expect(rendered).not.toMatch(/{{[A-Z_]+}}/);
    for (const value of Object.values(values('/tmp/ai-auto-content'))) expect(rendered).toContain(value);
  });

  it('contains no credential fields', async () => {
    const rendered = await renderLaunchdPlist(template, values('/tmp/ai-auto-content'));
    expect(rendered).not.toMatch(/auth_token|pass_ticket|Cookie:|Authorization:|github_pat_|ghp_/i);
  });

  it('install dry-run does not create the Application Support or LaunchAgents target', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'launchd-dry-run-home-'));
    roots.push(home);
    const paths = createRuntimePaths(home);
    const result = await installLocalRuntime(process.cwd(), false, paths);
    expect(result.mode).toBe('dry-run');
    await expect(access(paths.supportRoot)).rejects.toThrow();
    await expect(access(paths.launchAgentFile)).rejects.toThrow();
  });

  it('uninstall dry-run does not remove an existing file', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'launchd-uninstall-home-'));
    roots.push(home);
    const paths = createRuntimePaths(home);
    await mkdir(paths.launchAgentsDirectory, { recursive: true });
    await writeFile(paths.launchAgentFile, 'existing plist');
    const result = await uninstallLocalRuntime(false, paths);
    expect(result).toEqual({ mode: 'dry-run', launchAgentFile: paths.launchAgentFile, runtimePreserved: true });
    expect(await readFile(paths.launchAgentFile, 'utf8')).toBe('existing plist');
  });
});
