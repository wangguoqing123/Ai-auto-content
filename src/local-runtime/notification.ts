import { runCommand, type CommandResult } from './process.js';
import type { LocalRuntimeConfig, RuntimeTaskStatus } from './types.js';

export function safeNotificationMessage(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, '[link redacted]')
    .replace(/\b(?:xsec_token|pass_ticket|auth_token|ct0|authorization|cookie)\b\s*[:=]?\s*\S*/gi, '[sensitive value redacted]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

export function shouldNotify(status: RuntimeTaskStatus, config: LocalRuntimeConfig): boolean {
  if (!config.notification.enabled) return false;
  if (status === 'success') return config.notification.notify_on_success;
  if (status === 'partial_success') return config.notification.notify_on_partial_success;
  return status !== 'not_due' && status !== 'running' && config.notification.notify_on_failure;
}

export async function sendLocalNotification(
  status: RuntimeTaskStatus,
  message: string,
  config: LocalRuntimeConfig,
  execute: typeof runCommand = runCommand,
): Promise<boolean> {
  if (!shouldNotify(status, config) || process.platform !== 'darwin') return true;
  const safe = safeNotificationMessage(message).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  try {
    const result: CommandResult = await execute('/usr/bin/osascript', [
      '-e',
      `display notification "${safe}" with title "AI Auto Content"`,
    ], { timeoutMs: 5_000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
