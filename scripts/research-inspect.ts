import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { researchPackSchema } from '../src/research/schemas.js';

const argument = process.argv.find((value) => value.startsWith('--date='));
const date = argument?.slice('--date='.length) ?? '';
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date=YYYY-MM-DD is required');
const pack = researchPackSchema.parse(JSON.parse(await readFile(
  path.join(process.cwd(), 'data', 'research-packs', date, 'research-pack.json'), 'utf8',
)) as unknown);
process.stdout.write(`${JSON.stringify({
  research_date: pack.research_date,
  status: pack.status,
  decision: pack.decision,
  topic: pack.topic?.working_title ?? null,
  sources: pack.source_summary,
  verified_claims: pack.verified_claims.length,
  questions: Object.fromEntries(['answered', 'partial', 'unanswered'].map((status) => [
    status, pack.research_answers.filter((answer) => answer.answer_status === status).length,
  ])),
  experiment: pack.experiment?.results.map((result) => ({
    variant_id: result.variant_id, status: result.status, pass: result.criterion_pass_count, fail: result.criterion_fail_count,
  })) ?? null,
  model_calls: pack.model.calls,
}, null, 2)}\n`);
