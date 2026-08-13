import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadLocalRuntimeConfig } from './config.js';
import { runHealthCheck } from './health-check.js';
import { runMorningTask } from './morning-task.js';
import { createRuntimePaths } from './paths.js';

interface CliOptions {
  command: 'check' | 'morning' | 'scheduler';
  once: boolean;
  dryRun: boolean;
  fixture: boolean;
  now: Date;
}

function parseCli(args: string[]): CliOptions {
  const command = args[0];
  if (command !== 'check' && command !== 'morning' && command !== 'scheduler') {
    throw new Error('Expected command: check, morning, or scheduler');
  }
  let once = false;
  let dryRun = false;
  let fixture = false;
  let now = new Date();
  for (const argument of args.slice(1)) {
    if (argument === '--once') once = true;
    else if (argument === '--dry-run') dryRun = true;
    else if (argument === '--fixture') fixture = true;
    else if (argument.startsWith('--now=')) {
      now = new Date(argument.slice('--now='.length));
      if (Number.isNaN(now.getTime())) throw new Error(`Invalid --now value: ${argument}`);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (fixture && !dryRun) throw new Error('--fixture requires --dry-run');
  if (command === 'scheduler' && !once) once = true;
  return { command, once, dryRun, fixture, now };
}

export async function runLocalRuntimeCli(args: string[], repositoryRoot = process.cwd()): Promise<number> {
  let temporaryHome: string | null = null;
  try {
    const options = parseCli(args);
    if (options.fixture) temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'ai-auto-content-runtime-fixture-'));
    const paths = createRuntimePaths(temporaryHome ?? os.homedir());
    const config = await loadLocalRuntimeConfig(repositoryRoot, options.fixture ? undefined : paths.configFile);
    if (options.command === 'check') {
      const health = options.fixture
        ? {
          status: 'success',
          checks: [{ name: 'fixture_environment', ok: true, detail: 'offline fixture' }],
          error: null,
          platforms: { twitter: null, weixin: null },
        }
        : await runHealthCheck(config);
      process.stdout.write(`${JSON.stringify({ command: 'check', dry_run: options.dryRun, fixture: options.fixture, health }, null, 2)}\n`);
      return health.status === 'success' ? 0 : health.status === 'login_required' ? 4 : health.status === 'blocked' ? 5 : 3;
    }
    const execution = await runMorningTask({
      repositoryRoot,
      now: options.now,
      dryRun: options.dryRun,
      fixture: options.fixture,
      paths,
      config,
      triggerMode: options.command === 'morning' ? 'manual' : 'scheduled',
    });
    process.stdout.write(`${JSON.stringify({ command: options.command, once: options.once, dry_run: options.dryRun, fixture: options.fixture, execution }, null, 2)}\n`);
    return execution.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    if (temporaryHome) await rm(temporaryHome, { recursive: true, force: true });
  }
}
