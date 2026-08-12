import { runBrowserPipeline } from '../src/browser-pipeline.js';

function parseArgs(args: string[]): { dryRun: boolean } {
  let dryRun = false;
  for (const argument of args) {
    if (argument === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { dryRun };
}

try {
  const cli = parseArgs(process.argv.slice(2));
  const result = await runBrowserPipeline({ rootDir: process.cwd(), dryRun: cli.dryRun });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
