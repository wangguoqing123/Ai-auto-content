import { renderLaunchdPlist } from '../src/local-runtime/launchd.js';
import { createRuntimePaths } from '../src/local-runtime/paths.js';
import path from 'node:path';

const paths = createRuntimePaths();
const rendered = await renderLaunchdPlist(
  path.join(process.cwd(), 'launchd', 'com.ai-auto-content.local-scheduler.plist.template'),
  {
    wrapperPath: path.join(paths.runtimeRoot, 'scripts', 'local-scheduler-wrapper.sh'),
    nodePath: process.execPath,
    opencliPath: '/usr/local/bin/opencli',
    runtimeRoot: paths.runtimeRoot,
    stdoutPath: path.join(paths.logsDirectory, 'scheduler.stdout.log'),
    stderrPath: path.join(paths.logsDirectory, 'scheduler.stderr.log'),
  },
);
process.stdout.write(rendered);
