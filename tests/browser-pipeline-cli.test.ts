import { describe, expect, it } from 'vitest';
import { runBrowserPipelineCli } from '../src/browser-pipeline-cli.js';
import type { BrowserPipelineResult } from '../src/browser-pipeline.js';
import type { BrowserPlatformResult, OpenCliStatus } from '../src/collectors/opencli/opencli-capability.js';

function platform(platformName: BrowserPlatformResult['platform'], status: OpenCliStatus): BrowserPlatformResult {
  return {
    platform: platformName,
    status,
    started_at: '2026-08-12T00:00:00.000Z',
    finished_at: '2026-08-12T00:00:01.000Z',
    commands: [],
    materials: [],
    raw_materials_count: 0,
    materials_count: 0,
    duplicate_materials_count: 0,
    missing_fields: [],
    error: status === 'success' ? null : `${platformName} unavailable`,
  };
}

function result(
  status: BrowserPipelineResult['status'],
  platformStatuses: OpenCliStatus[],
): BrowserPipelineResult {
  const names = ['twitter', 'weixin'] as const;
  return {
    run_id: 'browser_20260812000000',
    collection_date: '2026-08-12',
    dry_run: true,
    started_at: '2026-08-12T00:00:00.000Z',
    finished_at: '2026-08-12T00:00:01.000Z',
    preflight: {
      args: ['doctor'],
      status: 'success',
      exit_code: 0,
      duration_ms: 1,
      timed_out: false,
      cancelled: false,
      error: null,
    },
    status,
    platforms: names.map((name, index) => platform(name, platformStatuses[index] ?? 'success')),
    raw_materials_count: 0,
    materials_count: 0,
    duplicate_materials_count: 0,
  };
}

function capture(): { writer: { write(chunk: string): void }; read(): string } {
  let value = '';
  return {
    writer: { write: (chunk) => { value += chunk; } },
    read: () => value,
  };
}

describe('browser pipeline CLI exit codes', () => {
  it('returns 0 for success', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runBrowserPipelineCli(['--dry-run'], {
      runPipeline: async () => result('success', ['success', 'success']),
      stdout: stdout.writer,
      stderr: stderr.writer,
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout.read())).toMatchObject({ status: 'success' });
    expect(stderr.read()).toBe('');
  });

  it('returns 0 and warns for partial success', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runBrowserPipelineCli(['--dry-run'], {
      runPipeline: async () => result('partial_success', ['success', 'blocked']),
      stdout: stdout.writer,
      stderr: stderr.writer,
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout.read())).toMatchObject({ status: 'partial_success' });
    expect(stderr.read()).toContain('WARNING: Browser Collector completed with partial success');
  });

  it('returns 2 for a failed pipeline', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runBrowserPipelineCli([], {
      runPipeline: async () => result('failed', ['unavailable', 'unavailable']),
      stdout: stdout.writer,
      stderr: stderr.writer,
    });
    expect(code).toBe(2);
    expect(stderr.read()).toContain('ERROR: Browser Collector failed');
  });

  it('returns 1 for an uncaught dependency error', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runBrowserPipelineCli([], {
      runPipeline: async () => { throw new Error('unexpected fixture failure'); },
      stdout: stdout.writer,
      stderr: stderr.writer,
    });
    expect(code).toBe(1);
    expect(stdout.read()).toBe('');
    expect(stderr.read()).toContain('unexpected fixture failure');
  });

  it('keeps the complete JSON diagnostics on stdout when the pipeline fails', async () => {
    const stdout = capture();
    const stderr = capture();
    const failedResult = result('failed', ['login_required', 'unavailable']);
    const code = await runBrowserPipelineCli([], {
      runPipeline: async () => failedResult,
      stdout: stdout.writer,
      stderr: stderr.writer,
    });
    expect(code).toBe(2);
    expect(JSON.parse(stdout.read())).toEqual(failedResult);
    expect(stderr.read()).toContain('twitter:login_required, weixin:unavailable');
  });
});
