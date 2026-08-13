import type { BrowserMaterialInput } from '../src/collectors/opencli/material-factory.js';
import { createBrowserMaterial } from '../src/collectors/opencli/material-factory.js';
import type { BrowserPlatformResult, OpenCliStatus } from '../src/collectors/opencli/opencli-capability.js';
import type { OpenCliRunResult } from '../src/collectors/opencli/opencli-runner.js';

export function commandResult(
  args: readonly string[],
  status: OpenCliStatus,
  data: unknown = null,
  error: string | null = null,
): OpenCliRunResult {
  return {
    args: [...args],
    status,
    exit_code: status === 'success' ? 0 : 1,
    duration_ms: 1,
    timed_out: false,
    cancelled: false,
    error,
    stdout: status === 'success' ? JSON.stringify(data) : '',
    stderr: error ?? '',
    data,
  };
}

export function browserMaterial(overrides: Partial<BrowserMaterialInput> = {}) {
  const canonicalUrl = overrides.canonicalUrl ?? 'https://x.com/i/status/123';
  return createBrowserMaterial({
    sourcePlatform: 'twitter',
    collector: 'opencli-twitter-rich',
    queryId: 'query-a',
    queryText: 'AI tools',
    searchRank: 2,
    sourceItemId: '123',
    authorName: 'author',
    authorFollowers: 100,
    title: 'A useful AI tool',
    excerpt: 'A useful AI tool for everyday work.',
    sourceUrl: canonicalUrl,
    canonicalUrl,
    contentPath: null,
    contentDownloaded: false,
    publishedAt: '2026-08-13T01:00:00.000Z',
    publishedAtQuality: 'exact',
    collectedAt: '2026-08-13T02:00:00.000Z',
    engagement: { likes: 10, views: 100 },
    usageMode: 'trend_signal',
    viralConfidence: 'candidate',
    ...overrides,
  });
}

export function platformResult(
  platform: BrowserPlatformResult['platform'],
  materials = [browserMaterial()],
  rawCount = materials.length,
): BrowserPlatformResult {
  return {
    platform,
    status: 'success',
    started_at: '2026-08-13T02:00:00.000Z',
    finished_at: '2026-08-13T02:00:01.000Z',
    commands: [],
    materials,
    raw_materials_count: rawCount,
    materials_count: materials.length,
    duplicate_materials_count: rawCount - materials.length,
    missing_fields: [],
    error: null,
  };
}
