import { describe, expect, it, vi } from 'vitest';
import { loadLocalRuntimeConfig } from '../src/local-runtime/config.js';
import { safeNotificationMessage, sendLocalNotification, shouldNotify } from '../src/local-runtime/notification.js';

describe('local notifications', () => {
  it('redacts secrets, URLs, and the local user directory', () => {
    const safe = safeNotificationMessage('Authorization: Bearer-secret https://example.com/?auth_token=hidden /Users/alice/project');
    expect(safe).not.toMatch(/Bearer-secret|example\.com|hidden|\/Users\/alice/);
  });

  it('notifies for partial success but not default success', async () => {
    const config = await loadLocalRuntimeConfig(process.cwd());
    expect(shouldNotify('partial_success', config)).toBe(true);
    expect(shouldNotify('success', config)).toBe(false);
  });

  it('does not notify for not_due', async () => {
    const config = await loadLocalRuntimeConfig(process.cwd());
    expect(shouldNotify('not_due', config)).toBe(false);
  });

  it('treats notification delivery as best effort', async () => {
    const config = await loadLocalRuntimeConfig(process.cwd());
    const execute = vi.fn(async () => { throw new Error('osascript failed'); });
    await expect(sendLocalNotification('partial_success', 'warning', config, execute)).resolves.toBeTypeOf('boolean');
  });
});
