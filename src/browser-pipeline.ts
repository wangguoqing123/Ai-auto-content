import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPlatformQueries } from './config/load-platform-queries.js';
import type { BrowserPlatform, BrowserPlatformResult } from './collectors/opencli/opencli-capability.js';
import { OpenCliRunner, toCommandSummary } from './collectors/opencli/opencli-runner.js';
import { TwitterCollector } from './collectors/opencli/twitter-collector.js';
import { WeixinCollector } from './collectors/opencli/weixin-collector.js';
import { deduplicateUnifiedMaterials } from './collectors/opencli/merge-materials.js';
import type { PlatformQueriesConfig } from './collectors/opencli/platform-config.js';
import { unifiedMaterialSchema, type UnifiedMaterial } from './types.js';
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
  raw_materials_count: number;
  materials_count: number;
  duplicate_materials_count: number;
}

export const ACTIVE_BROWSER_PLATFORMS = ['twitter', 'weixin'] as const satisfies readonly BrowserPlatform[];

function unavailablePlatform(platform: BrowserPlatform, now: Date, preflight: ReturnType<typeof toCommandSummary>): BrowserPlatformResult {
  return {
    platform,
    status: preflight.status,
    started_at: now.toISOString(),
    finished_at: new Date().toISOString(),
    commands: [preflight],
    materials: [],
    raw_materials_count: 0,
    materials_count: 0,
    duplicate_materials_count: 0,
    missing_fields: [],
    error: preflight.error,
  };
}

export async function persistBrowserResult(rootDir: string, date: string, result: BrowserPipelineResult): Promise<void> {
  const materialDirectory = path.join(rootDir, 'data', 'browser-materials');
  const runDirectory = path.join(rootDir, 'data', 'browser-runs');
  await Promise.all([mkdir(materialDirectory, { recursive: true }), mkdir(runDirectory, { recursive: true })]);
  const materials = result.platforms.flatMap((platform) => platform.materials);
  const materialPath = path.join(materialDirectory, `${date}.jsonl`);
  let existing: UnifiedMaterial[] = [];
  try {
    existing = (await readFile(materialPath, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => unifiedMaterialSchema.parse(JSON.parse(line)));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const serialized = deduplicateUnifiedMaterials([...existing, ...materials]);
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
    platforms = ACTIVE_BROWSER_PLATFORMS.map((platform) => unavailablePlatform(platform, now, preflight));
  } else {
    const outputDirectory = options.dryRun
      ? (temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ai-auto-content-weixin-')))
      : path.join(options.rootDir, 'data', 'weixin-articles', date);
    const collectors = options.collectors ?? [
      new TwitterCollector(runner, config.twitter),
      new WeixinCollector(runner, config.weixin, outputDirectory, options.rootDir, options.dryRun),
    ];
    const settled = await Promise.allSettled(collectors.map((collector) => collector.collect(now, options.signal)));
    platforms = settled.map((entry, index) => entry.status === 'fulfilled' ? entry.value : {
      platform: ACTIVE_BROWSER_PLATFORMS[index] ?? 'twitter',
      status: 'command_failed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      commands: [],
      materials: [],
      raw_materials_count: 0,
      materials_count: 0,
      duplicate_materials_count: 0,
      missing_fields: [],
      error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
    });
  }

  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    platforms = platforms.map((platform) => ({
      ...platform,
      materials: platform.materials.map((material) => material.content_path
        ? unifiedMaterialSchema.parse({ ...material, content_path: null, content_downloaded: true })
        : material),
    }));
  }
  platforms = platforms.map((platform) => {
    const materials = deduplicateUnifiedMaterials(platform.materials);
    const rawCount = Math.max(platform.raw_materials_count, materials.length);
    return {
      ...platform,
      materials,
      raw_materials_count: rawCount,
      materials_count: materials.length,
      duplicate_materials_count: rawCount - materials.length,
    };
  });
  const succeeded = platforms.filter((platform) => platform.status === 'success').length;
  const operational = platforms.filter((platform) => platform.status === 'success' || platform.status === 'partial_success').length;
  const allMaterials = deduplicateUnifiedMaterials(platforms.flatMap((platform) => platform.materials));
  const rawMaterialsCount = platforms.reduce((sum, platform) => sum + platform.raw_materials_count, 0);
  const result: BrowserPipelineResult = {
    run_id: `browser_${startedAt.replace(/\D/g, '').slice(0, 14)}`,
    collection_date: date,
    dry_run: options.dryRun,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    preflight,
    status: succeeded === platforms.length ? 'success' : operational > 0 ? 'partial_success' : 'failed',
    platforms,
    raw_materials_count: rawMaterialsCount,
    materials_count: allMaterials.length,
    duplicate_materials_count: rawMaterialsCount - allMaterials.length,
  };
  if (!options.dryRun) await persistBrowserResult(options.rootDir, date, result);
  return result;
}
