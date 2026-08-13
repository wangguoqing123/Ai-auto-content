import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { PlatformQueriesConfig } from '../collectors/opencli/platform-config.js';

const baseQuery = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  enabled: z.boolean(),
  priority: z.number().int().optional(),
});

const positiveBudget = z.number().int().min(1);

const platformQueriesSchema = z.object({
  version: z.number().int().positive(),
  twitter: z.object({
    max_queries_per_run: positiveBudget.max(4),
    max_results_per_query: positiveBudget.max(20),
    queries: z.array(baseQuery.extend({
      language: z.enum(['zh', 'en']),
      product: z.enum(['top', 'live']),
      exclude_replies: z.boolean(),
      exclude_retweets: z.boolean(),
      minimum_likes: z.number().int().nonnegative(),
      minimum_views: z.number().int().nonnegative(),
    })),
  }),
  weixin: z.object({
    max_queries_per_run: positiveBudget.max(4),
    max_results_per_query: positiveBudget.max(10),
    max_downloads_per_run: positiveBudget.max(5),
    queries: z.array(baseQuery),
  }),
}).strict();

export async function loadPlatformQueries(rootDir = process.cwd()): Promise<PlatformQueriesConfig> {
  const contents = await readFile(path.join(rootDir, 'config', 'platform-queries.yaml'), 'utf8');
  return platformQueriesSchema.parse(parse(contents)) as PlatformQueriesConfig;
}
