import { describe, expect, it } from 'vitest';
import { runBrowserPipeline } from '../src/browser-pipeline.js';
import type { BrowserPlatformResult } from '../src/collectors/opencli/opencli-capability.js';
import { OpenCliRunner, type OpenCliRunResult } from '../src/collectors/opencli/opencli-runner.js';
import { loadPlatformQueries } from '../src/config/load-platform-queries.js';

function platform(platform: BrowserPlatformResult['platform']): BrowserPlatformResult {
  return {
    platform,
    status: 'success',
    started_at: '2026-08-12T00:00:00.000Z',
    finished_at: '2026-08-12T00:00:01.000Z',
    commands: [],
    materials: [],
    missing_fields: [],
    error: null,
  };
}

describe('browser pipeline isolation', () => {
  it('keeps other platforms running when one collector throws', async () => {
    const preflight: OpenCliRunResult = {
      args: ['doctor'], status: 'success', exit_code: 0, duration_ms: 1, timed_out: false, cancelled: false,
      error: null, stdout: 'ok', stderr: '', data: 'ok',
    };
    const runner = { run: async () => preflight } as unknown as OpenCliRunner;
    const config = await loadPlatformQueries(process.cwd());
    const result = await runBrowserPipeline({
      rootDir: process.cwd(),
      dryRun: true,
      runner,
      config,
      now: new Date('2026-08-12T00:00:00.000Z'),
      collectors: [
        { collect: async () => platform('twitter') },
        { collect: async () => { throw new Error('isolated fixture failure'); } },
        { collect: async () => platform('weixin') },
      ],
    });
    expect(result.status).toBe('partial_success');
    expect(result.platforms.map((entry) => entry.status)).toEqual(['success', 'command_failed', 'success']);
  });
});
