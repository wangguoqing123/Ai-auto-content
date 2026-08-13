import os from 'node:os';
import path from 'node:path';
import type { RuntimePaths } from './types.js';

export function createRuntimePaths(homeDirectory = os.homedir()): RuntimePaths {
  const supportRoot = path.join(homeDirectory, 'Library', 'Application Support', 'AiAutoContent');
  const launchAgentsDirectory = path.join(homeDirectory, 'Library', 'LaunchAgents');
  return {
    supportRoot,
    runtimeRoot: path.join(supportRoot, 'runtime'),
    stateDirectory: path.join(supportRoot, 'state'),
    stateFile: path.join(supportRoot, 'state', 'scheduler-state.json'),
    lockDirectory: path.join(supportRoot, 'locks', 'morning.lock'),
    configDirectory: path.join(supportRoot, 'config'),
    configFile: path.join(supportRoot, 'config', 'local-runtime.yaml'),
    logsDirectory: path.join(homeDirectory, 'Library', 'Logs', 'AiAutoContent'),
    launchAgentsDirectory,
    launchAgentFile: path.join(launchAgentsDirectory, 'com.ai-auto-content.local-scheduler.plist'),
  };
}
