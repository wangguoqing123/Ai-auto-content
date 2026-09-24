import { runSimpleWritingBuild } from '../src/simple-writing/pipeline.js';
import type { SimpleWritingFixtureScenario } from '../src/simple-writing/input.js';

interface CliOptions {
  writingDate: string;
  fixture: boolean;
  dryRun: boolean;
  fixtureScenario: SimpleWritingFixtureScenario;
  outputRoot?: string;
}

function parseCli(args: string[]): CliOptions {
  let writingDate = '';
  let fixture = false;
  let dryRun = false;
  let fixtureScenario: SimpleWritingFixtureScenario = 'ready';
  let outputRoot: string | undefined;
  for (const argument of args) {
    if (argument === '--fixture') fixture = true;
    else if (argument === '--dry-run') dryRun = true;
    else if (argument.startsWith('--date=')) writingDate = argument.slice('--date='.length);
    else if (argument.startsWith('--output-root=')) outputRoot = argument.slice('--output-root='.length);
    else if (argument.startsWith('--fixture-scenario=')) {
      const value = argument.slice('--fixture-scenario='.length);
      if (!['ready', 'no-publish', 'waiting', 'no-sources'].includes(value)) {
        throw new Error(`Invalid --fixture-scenario value: ${value}`);
      }
      fixtureScenario = value as SimpleWritingFixtureScenario;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(writingDate) || Number.isNaN(Date.parse(`${writingDate}T00:00:00Z`))) {
    throw new Error('Expected --date=YYYY-MM-DD');
  }
  if (fixture && !dryRun) throw new Error('--fixture requires --dry-run');
  if (!fixture && fixtureScenario !== 'ready') throw new Error('--fixture-scenario requires --fixture');
  if (outputRoot !== undefined && outputRoot.trim() === '') throw new Error('--output-root cannot be empty');
  return {
    writingDate,
    fixture,
    dryRun,
    fixtureScenario,
    ...(outputRoot === undefined ? {} : { outputRoot }),
  };
}

try {
  const options = parseCli(process.argv.slice(2));
  const result = await runSimpleWritingBuild({
    rootDir: process.cwd(),
    writingDate: options.writingDate,
    fixture: options.fixture,
    fixtureScenario: options.fixtureScenario,
    dryRun: options.dryRun,
    ...(options.outputRoot === undefined ? {} : { outputRoot: options.outputRoot }),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.pack.status === 'failed' ? 1 : 0;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
