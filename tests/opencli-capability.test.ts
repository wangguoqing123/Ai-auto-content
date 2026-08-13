import { describe, expect, it } from 'vitest';
import { summarizePlatformStatus } from '../src/collectors/opencli/opencli-capability.js';

describe('OpenCLI platform status precedence', () => {
  it.each([
    [['command_failed', 'login_required'], 'login_required'],
    [['command_failed', 'blocked'], 'blocked'],
    [['unavailable'], 'unavailable'],
    [['command_failed'], 'command_failed'],
  ] as const)('selects %s as %s when no material was produced', (failures, expected) => {
    expect(summarizePlatformStatus(0, [...failures])).toBe(expected);
  });

  it('keeps partial_success when real material exists despite a terminal failure', () => {
    expect(summarizePlatformStatus(1, ['command_failed', 'blocked'])).toBe('partial_success');
  });
});
