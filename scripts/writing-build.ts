import { runWritingBuild } from '../src/writing/pipeline.js';

function parse(args: string[]) {
  let writingDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let dryRun = false;
  let fixture = false;
  let syntheticReadyFixture = false;
  let allowProvisionalStyle = false;
  let styleProfilePath: string | undefined;
  let approvalReceiptPath: string | undefined;
  let bindingAttestationPath: string | undefined;
  const take = (argument: string, index: number, name: string): [string, number] => {
    if (argument === name) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a path`);
      return [value, index + 1];
    }
    return [argument.slice(`${name}=`.length), index];
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--dry-run') dryRun = true;
    else if (argument === '--fixture') fixture = true;
    else if (argument === '--synthetic-ready-fixture') syntheticReadyFixture = true;
    else if (argument === '--allow-provisional-style') allowProvisionalStyle = true;
    else if (argument.startsWith('--date=')) writingDate = argument.slice('--date='.length);
    else if (argument === '--style-profile' || argument.startsWith('--style-profile=')) [styleProfilePath, index] = take(argument, index, '--style-profile');
    else if (argument === '--approval-receipt' || argument.startsWith('--approval-receipt=')) [approvalReceiptPath, index] = take(argument, index, '--approval-receipt');
    else if (argument === '--binding-attestation' || argument.startsWith('--binding-attestation=')) [bindingAttestationPath, index] = take(argument, index, '--binding-attestation');
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(writingDate)) throw new Error('--date must use YYYY-MM-DD');
  return {
    writingDate, dryRun, fixture, syntheticReadyFixture, allowProvisionalStyle,
    ...(styleProfilePath === undefined ? {} : { styleProfilePath }),
    ...(approvalReceiptPath === undefined ? {} : { approvalReceiptPath }),
    ...(bindingAttestationPath === undefined ? {} : { bindingAttestationPath }),
  };
}

try {
  const result = await runWritingBuild(parse(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.pack.status === 'success' ? 0 : 2;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
