import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPlatformQueries } from './config/load-platform-queries.js';
import type { BrowserPlatform, BrowserPlatformResult } from './collectors/opencli/opencli-capability.js';
import { OpenCliRunner, toCommandSummary } from './collectors/opencli/opencli-runner.js';
import { TwitterCollector } from './collectors/opencli/twitter-collector.js';
import { WeixinCollector } from './collectors/opencli/weixin-collector.js';
import { XiaohongshuCollector } from './collectors/opencli/xiaohongshu-collector.js';
import type { PlatformQueriesConfig } from './collectors/opencli/platform-config.js';
import type { UnifiedMaterial } from './types.js';
import { formatDateInTimeZone } from './utils/time.js';

export interface BrowserPipelineOptions {
  rootDir: string;
  dryRun: boolean;
  runner?: OpenCliRunner;
  config?: PlatformQueriesConfig;
  now?: Date;
  collectors?: Array<{ collect(now: Date, signal?: AbortSignal): Promise<BrowserPlatformResult> }>;
  signal?: AbortSignal;
}

export interface BrowserPipelineResult {
  run_id: string;
  collection_date: string;
  dry_run: boolean;
  started_at: string;
  finished_at: string;
  preflight: ReturnType<typeof toCommandSummary>;
  status: 'success' | 'partial_success' | 'failed';
  platforms: BrowserPlatformResult[];
  materials_count: number;
}

function unavailablePlatform(platform: BrowserPlatform, now: Date, preflight: ReturnType<typeof toCommandSummary>): BrowserPlatformResult {
  return {
    platform,
    status: preflight.status,
    started_at: now.toISOString(),
    finished_at: new Date().toISOString(),
    commands: [preflight],
    materials: [],
    missing_fields: [],
    error: preflight.error,
  };
}

async function persistBrowserResult(rootDir: string, date: string, result: BrowserPipelineResult): Promise<void> {
  const materialDirectory = path.join(rootDir, 'data', 'browser-materials');
  const runDirectory = path.join(rootDir, 'data', 'browser-runs');
  await Promise.all([mkdir(materialDirectory, { recursive: true }), mkdir(runDirectory, { recursive: true })]);
  const materials = result.platforms.flatMap((platform) => platform.materials);
  const materialPath = path.join(materialDirectory, `${date}.jsonl`);
  let existing: UnifiedMaterial[] = [];
  try {
    existing = (await readFile(materialPath, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as UnifiedMaterial);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const byId = new Map(existing.map((material) => [material.material_id, material]));
  for (const material of materials) byId.set(material.material_id, material);
  const serialized = [...byId.values()].sort((left, right) => left.material_id.localeCompare(right.material_id));
  await writeFile(materialPath, serialized.length ? `${serialized.map((material) => JSON.stringify(material)).join('\n')}\n` : '', 'utf8');
  await writeFile(path.join(runDirectory, `${result.run_id}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

export async function runBrowserPipeline(options: BrowserPipelineOptions): Promise<BrowserPipelineResult> {
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const runner = options.runner ?? new OpenCliRunner();
  const config = options.config ?? await loadPlatformQueries(options.rootDir);
  const preflightResult = await runner.run(['doctor'], { parseJson: false, timeoutMs: 15_000, signal: options.signal });
  const preflight = toCommandSummary(preflightResult);
  const date = formatDateInTimeZone(now);
  let platforms: BrowserPlatformResult[];
  let temporaryDirectory: string | null = null;

  if (preflightResult.status !== 'success') {
    platforms = (['twitter', 'xiaohongshu', 'weixin'] as const).map((platform) => unavailablePlatform(platform, now, preflight));
  } else {
    const outputDirectory = options.dryRun
      ? (temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ai-auto-content-weixin-')))
      : path.join(options.rootDir, 'data', 'weixin-articles', date);
    const collectors = options.collectors ?? [
      new TwitterCollector(runner, config.twitter),
      new XiaohongshuCollector(runner, config.xiaohongshu),
      new WeixinCollector(runner, config.weixin, outputDirectory),
    ];
    const settled = await Promise.allSettled(collectors.map((collector) => collector.collect(now, options.signal)));
    platforms = settled.map((entry, index) => entry.status === 'fulfilled' ? entry.value : {
      platform: (['twitter', 'xiaohongshu', 'weixin'] as const)[index] ?? 'twitter',
      status: 'command_failed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      commands: [],
      materials: [],
      missing_fields: [],
      error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
    });
  }

  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  const succeeded = platforms.filter((platform) => platform.status === 'success').length;
  const result: BrowserPipelineResult = {
    run_id: `browser_${startedAt.replace(/\D/g, '').slice(0, 14)}`,
    collection_date: date,
    dry_run: options.dryRun,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    preflight,
    status: succeeded === platforms.length ? 'success' : succeeded > 0 ? 'partial_success' : 'failed',
    platforms,
    materials_count: platforms.reduce((sum, platform) => sum + platform.materials.length, 0),
  };
  if (!options.dryRun) await persistBrowserResult(options.rootDir, date, result);
  return result;
}
