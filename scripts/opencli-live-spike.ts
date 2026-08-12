import { performance } from 'node:perf_hooks';
import { runBrowserPipeline } from '../src/browser-pipeline.js';

const AIHOT_ENDPOINTS = {
  selected_24h: 'https://aihot.virxact.com/api/v1/items?mode=selected&window=24h&limit=5',
  hot_topics: 'https://aihot.virxact.com/api/v1/hot-topics',
  product_updates: 'https://aihot.virxact.com/api/v1/items?mode=selected&window=7d&category=ai-products&limit=5',
  tips: 'https://aihot.virxact.com/api/v1/items?mode=selected&window=7d&category=tip&limit=5',
} as const;

async function validateAihot(): Promise<Record<string, unknown>> {
  const entries = await Promise.all(Object.entries(AIHOT_ENDPOINTS).map(async ([name, url]) => {
    const started = performance.now();
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'aihot-skill/1.4.1 (+https://aihot.virxact.com/aihot-skill/)' },
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json() as Record<string, unknown>;
      const items = Array.isArray(payload.items) ? payload.items : [];
      return [name, {
        status: response.ok ? 'verified_live' : 'temporarily_blocked',
        http_status: response.status,
        duration_ms: Math.round(performance.now() - started),
        count: typeof payload.count === 'number' ? payload.count : items.length,
        fields: items[0] && typeof items[0] === 'object' ? Object.keys(items[0] as object) : [],
      }];
    } catch (error) {
      return [name, {
        status: 'temporarily_blocked',
        duration_ms: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
      }];
    }
  }));
  return Object.fromEntries(entries);
}

const [opencli, aihot] = await Promise.all([
  runBrowserPipeline({ rootDir: process.cwd(), dryRun: true }),
  validateAihot(),
]);

console.log(JSON.stringify({ executed_at: new Date().toISOString(), opencli, aihot }, null, 2));
