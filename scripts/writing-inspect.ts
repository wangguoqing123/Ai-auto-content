import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writingPackSchema } from '../src/writing/schemas.js';

const date = process.argv.find((value) => value.startsWith('--date='))?.slice('--date='.length) ?? '';
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date=YYYY-MM-DD is required');
const pack = writingPackSchema.parse(JSON.parse(await readFile(path.join(process.cwd(), 'data', 'writing-packs', date, 'writing-pack.json'), 'utf8')) as unknown);
process.stdout.write(`${JSON.stringify({
  writing_date: pack.writing_date, status: pack.status, decision: pack.decision, research_decision: pack.research.research_decision,
  style_status: pack.style?.style_status ?? null, production_eligible: pack.style?.production_eligible ?? null,
  wechat_chinese_characters: pack.wechat?.chinese_character_count ?? null,
  x_format: pack.x?.format ?? null, x_items: pack.x?.format === 'thread' ? pack.x.thread.length : pack.x === null ? 0 : 1,
  model_calls: pack.model.calls, human_gate: pack.human_gate,
}, null, 2)}\n`);
