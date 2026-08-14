import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadFactSourceMaterials } from '../src/research/source-materials.js';
import { topicDecisionSchema, type TopicDecision } from '../src/topic-intelligence/schemas.js';

const roots: string[] = [];
let decision: TopicDecision;
let material: Record<string, unknown>;

beforeAll(async () => {
  decision = topicDecisionSchema.parse(JSON.parse(await readFile(path.join(process.cwd(), 'data/topic-decisions/2026-08-14.json'), 'utf8')));
  const line = (await readFile(path.join(process.cwd(), 'data/materials/2026-08-13.jsonl'), 'utf8'))
    .split(/\r?\n/).find((value) => value.includes('mat_e063daae6225'))!;
  material = JSON.parse(line) as Record<string, unknown>;
});

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function repository(record: Record<string, unknown> | null) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-source-material-'));
  roots.push(root);
  await mkdir(path.join(root, 'data', 'materials'), { recursive: true });
  if (record !== null) await writeFile(path.join(root, 'data/materials/fixture.jsonl'), `${JSON.stringify(record)}\n`);
  return root;
}

function selected(id: string) {
  const value = structuredClone(decision);
  value.selected_topic!.fact_source_ids = [id];
  value.selected_topic!.supported_claims = [{ claim: 'Fixture claim', fact_source_ids: [id] }];
  return value;
}

describe('Topic-bound fact source material loading', () => {
  it('loads only the requested accepted official fact source', async () => {
    const root = await repository(material);
    await expect(loadFactSourceMaterials(root, selected(String(material.material_id)), 5)).resolves.toMatchObject([
      { material_id: material.material_id, status: 'accepted', source_access_status: 'resolved' },
    ]);
  });

  it('rejects a missing material ID', async () => {
    const root = await repository(null);
    await expect(loadFactSourceMaterials(root, selected('mat_111111111111'), 5)).rejects.toMatchObject({ code: 'source_material_invalid' });
  });

  it.each([
    ['twitter', 'ugc', 'trend_signal', 'https://x.com/user/status/1'],
    ['xiaohongshu', 'ugc', 'structure_inspiration', 'https://www.xiaohongshu.com/explore/abc'],
    ['aihot', 'news', 'reference_only', 'https://aihot.example/item'],
  ])('rejects non-fact source platform %s', async (sourcePlatform, sourceKind, usageMode, canonicalUrl) => {
    const record: Record<string, unknown> = { ...material, source_platform: sourcePlatform, source_kind: sourceKind, usage_mode: usageMode, canonical_url: canonicalUrl };
    const root = await repository(record);
    await expect(loadFactSourceMaterials(root, selected(String(record.material_id)), 5)).rejects.toMatchObject({ code: 'source_material_invalid' });
  });

  it.each([
    ['rejected', 'resolved'],
    ['quarantined', 'resolved'],
    ['accepted', 'unresolved'],
  ])('rejects source status=%s access=%s', async (status, sourceAccessStatus) => {
    const record: Record<string, unknown> = { ...material, status, source_access_status: sourceAccessStatus };
    const root = await repository(record);
    await expect(loadFactSourceMaterials(root, selected(String(record.material_id)), 5)).rejects.toMatchObject({ code: 'source_material_invalid' });
  });

  it.each(['not-a-url', 'file:///tmp/article', 'ftp://example.com/article'])('rejects invalid canonical URL %s', async (canonicalUrl) => {
    const record: Record<string, unknown> = { ...material, canonical_url: canonicalUrl };
    const root = await repository(record);
    await expect(loadFactSourceMaterials(root, selected(String(record.material_id)), 5)).rejects.toMatchObject({ code: 'source_material_invalid' });
  });

  it('rejects a temporary Weixin access URL even when the source is official and resolved', async () => {
    const record: Record<string, unknown> = {
      ...material, source_platform: 'weixin', source_kind: 'official', usage_mode: 'fact_source',
      canonical_url: 'https://mp.weixin.qq.com/s?signature=temporary-secret',
    };
    const root = await repository(record);
    await expect(loadFactSourceMaterials(root, selected(String(record.material_id)), 5)).rejects.toMatchObject({ code: 'source_material_invalid' });
  });

  it('rejects a fact source count over the configured maximum', async () => {
    const root = await repository(material);
    const value = structuredClone(decision);
    value.selected_topic!.fact_source_ids = ['mat_111111111111', 'mat_222222222222'];
    await expect(loadFactSourceMaterials(root, value, 1)).rejects.toMatchObject({ code: 'source_material_invalid' });
  });
});
