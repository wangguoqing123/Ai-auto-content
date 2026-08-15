import { runResearchBuild } from '../src/research/pipeline.js';

function parse(args: string[]) {
  let researchDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  let dryRun = false;
  let fixture = false;
  for (const argument of args) {
    if (argument === '--dry-run') dryRun = true;
    else if (argument === '--fixture') fixture = true;
    else if (argument.startsWith('--date=')) researchDate = argument.slice('--date='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(researchDate)) throw new Error('--date must use YYYY-MM-DD');
  return { researchDate, dryRun, fixture };
}

try {
  const options = parse(process.argv.slice(2));
  const result = await runResearchBuild(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.pack.status === 'success' ? 0 : 2;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
