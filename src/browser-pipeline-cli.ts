import { runBrowserPipeline, type BrowserPipelineOptions, type BrowserPipelineResult } from './browser-pipeline.js';

interface TextWriter {
  write(chunk: string): unknown;
}

export interface BrowserPipelineCliDependencies {
  runPipeline?: (options: BrowserPipelineOptions) => Promise<BrowserPipelineResult>;
  rootDir?: string;
  stdout?: TextWriter;
  stderr?: TextWriter;
}

function parseArgs(args: string[]): { dryRun: boolean } {
  let dryRun = false;
  for (const argument of args) {
    if (argument === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { dryRun };
}

function failureSummary(result: BrowserPipelineResult): string {
  const failures = result.platforms
    .filter((platform) => platform.status !== 'success')
    .map((platform) => `${platform.platform}:${platform.status}`);
  return failures.length > 0 ? failures.join(', ') : `pipeline:${result.status}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export async function runBrowserPipelineCli(
  args: string[],
  dependencies: BrowserPipelineCliDependencies = {},
): Promise<number> {
  const runPipeline = dependencies.runPipeline ?? runBrowserPipeline;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;

  try {
    const cli = parseArgs(args);
    const result = await runPipeline({
      rootDir: dependencies.rootDir ?? process.cwd(),
      dryRun: cli.dryRun,
    });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    if (result.status === 'partial_success') {
      stderr.write(`WARNING: Browser Collector completed with partial success (${failureSummary(result)}).\n`);
      return 0;
    }
    if (result.status === 'failed') {
      stderr.write(`ERROR: Browser Collector failed (${failureSummary(result)}).\n`);
      return 2;
    }
    return 0;
  } catch (error) {
    stderr.write(`${formatError(error)}\n`);
    return 1;
  }
}
