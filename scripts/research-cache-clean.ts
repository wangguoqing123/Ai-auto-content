import { cleanResearchCache, defaultResearchCacheRoot } from '../src/research/cache.js';

const argument = process.argv.find((value) => value.startsWith('--older-than-days='));
const days = Number(argument?.slice('--older-than-days='.length));
if (!Number.isInteger(days) || days < 0) throw new Error('--older-than-days=N is required');
const removed = await cleanResearchCache(defaultResearchCacheRoot(), days);
process.stdout.write(`${JSON.stringify({ removed, older_than_days: days })}\n`);
