import { installLocalRuntime } from '../src/local-runtime/launchd.js';

const args = process.argv.slice(2);
const install = args.includes('--install');
if (args.some((argument) => argument !== '--install' && argument !== '--dry-run')) {
  throw new Error('Supported arguments: --dry-run or --install');
}
const result = await installLocalRuntime(process.cwd(), install);
console.log(JSON.stringify(result, null, 2));
