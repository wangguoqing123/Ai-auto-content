import { uninstallLocalRuntime } from '../src/local-runtime/launchd.js';

const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
if (args.some((argument) => argument !== '--uninstall' && argument !== '--dry-run')) {
  throw new Error('Supported arguments: --dry-run or --uninstall');
}
const result = await uninstallLocalRuntime(uninstall);
console.log(JSON.stringify(result, null, 2));
