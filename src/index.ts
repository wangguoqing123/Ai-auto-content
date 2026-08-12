import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config/load-config.js';
import { RssCollector } from './collectors/rss-collector.js';
import { AllSourcesFailedError, runCollectionPipeline } from './pipeline.js';
import { logger } from './utils/logger.js';
import { formatDateInTimeZone, isValidDateArgument } from './utils/time.js';

interface CliOptions {
  date: string;
  dryRun: boolean;
  fixture: boolean;
}

function parseCliOptions(args: string[], now = new Date()): CliOptions {
  let date = formatDateInTimeZone(now);
  let dryRun = false;
  let fixture = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') dryRun = true;
    else if (argument === '--fixture') fixture = true;
    else if (argument?.startsWith('--date=')) date = argument.slice('--date='.length);
    else if (argument === '--date') {
      date = args[index + 1] ?? '';
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!isValidDateArgument(date)) throw new Error(`Invalid --date value: ${date}`);
  return { date, dryRun, fixture };
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const cli = parseCliOptions(process.argv.slice(2));
  const config = await loadConfig(rootDir);
  let sources = config.sources.sources;
  let collector: RssCollector;

  if (cli.fixture) {
    const fixtureXml = await readFile(path.join(rootDir, 'tests', 'fixtures', 'rss.xml'), 'utf8');
    const fixtureSource = sources.find((source) => source.enabled);
    if (!fixtureSource) throw new Error('Fixture mode requires one enabled source');
    sources = [fixtureSource];
    collector = new RssCollector({
      timeoutMs: config.scoring.collector.timeout_ms,
      userAgent: config.scoring.collector.user_agent,
      retries: 0,
      fetchXml: async () => fixtureXml,
      logger,
    });
  } else {
    collector = new RssCollector({
      timeoutMs: config.scoring.collector.timeout_ms,
      retries: config.scoring.collector.retries,
      userAgent: config.scoring.collector.user_agent,
      logger,
    });
  }

  const result = await runCollectionPipeline({
    rootDir,
    date: cli.date,
    sources,
    scoring: config.scoring,
    collector,
    dryRun: cli.dryRun,
    logger,
  });
  console.log(JSON.stringify(result.run, null, 2));
  if (cli.dryRun) console.log(result.report);
}

main().catch((error: unknown) => {
  if (error instanceof AllSourcesFailedError) {
    console.error(JSON.stringify(error.result.run, null, 2));
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  process.exitCode = 1;
});
