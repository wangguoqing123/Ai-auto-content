import { runLocalRuntimeCli } from '../src/local-runtime/scheduler.js';

process.exitCode = await runLocalRuntimeCli(process.argv.slice(2));
