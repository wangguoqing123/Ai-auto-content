import { runBrowserPipelineCli } from '../src/browser-pipeline-cli.js';

process.exitCode = await runBrowserPipelineCli(process.argv.slice(2));
