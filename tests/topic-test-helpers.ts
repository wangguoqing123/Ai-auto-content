import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadTopicIntelligenceConfig } from '../src/topic-intelligence/config.js';
import { buildFixtureMaterialInput, fixtureCandidate } from '../src/topic-intelligence/providers/fixture-topic-judge-provider.js';
import type { TopicCandidateProposal, TopicIntelligenceConfig } from '../src/topic-intelligence/schemas.js';
import { unifiedMaterialSchema, type UnifiedMaterial } from '../src/types.js';

export function makeTopicMaterial(overrides: Partial<UnifiedMaterial> = {}): UnifiedMaterial {
  return unifiedMaterialSchema.parse({
    material_id: 'mat_aaaaaaaaaaaa',
    source_platform: 'rss',
    source_kind: 'official',
    collector: 'fixture',
    query_id: '',
    query_text: '',
    search_rank: null,
    source_item_id: 'fixture-item',
    identity_aliases: [],
    source_access_status: 'resolved',
    author_name: 'Fixture Author',
    author_followers: null,
    title: 'A practical official AI workflow guide',
    excerpt: 'A bounded fixture excerpt for a real user task.',
    source_url: 'https://example.com/source',
    canonical_url: 'https://example.com/source',
    content_path: null,
    content_downloaded: false,
    published_at: '2026-08-13T04:00:00.000Z',
    published_at_quality: 'exact',
    collected_at: '2026-08-13T05:00:00.000Z',
    engagement: {
      views: null, likes: null, comments: null, shares: null,
      reposts: null, quotes: null, bookmarks: null, collects: null,
    },
    metric_quality: 'unavailable',
    usage_mode: 'fact_source',
    viral_confidence: 'unverified',
    status: 'accepted',
    rejection_reasons: [],
    ...overrides,
  });
}

export function makeTopicCandidate(overrides: Partial<TopicCandidateProposal> = {}): TopicCandidateProposal {
  return { ...structuredClone(fixtureCandidate()), ...overrides };
}

export async function topicConfig(): Promise<TopicIntelligenceConfig> {
  return loadTopicIntelligenceConfig(process.cwd());
}

export async function createTopicTestRoot(materials: UnifiedMaterial[] = []): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'topic-intelligence-test-'));
  await Promise.all([
    mkdir(path.join(root, 'config'), { recursive: true }),
    mkdir(path.join(root, 'data', 'materials'), { recursive: true }),
    mkdir(path.join(root, 'data', 'browser-materials'), { recursive: true }),
  ]);
  await Promise.all(['product.yaml', 'content-fit.yaml', 'project.yaml', 'topic-intelligence.yaml'].map((file) =>
    copyFile(path.join(process.cwd(), 'config', file), path.join(root, 'config', file))));
  if (materials.length > 0) await writeTopicMaterials(root, materials);
  return root;
}

export async function writeTopicMaterials(root: string, materials: UnifiedMaterial[]): Promise<void> {
  const cloud = materials.filter(({ source_platform }) => source_platform === 'rss' || source_platform === 'aihot');
  const browser = materials.filter(({ source_platform }) => source_platform === 'twitter' || source_platform === 'weixin' || source_platform === 'xiaohongshu');
  await Promise.all([
    writeFile(path.join(root, 'data', 'materials', 'fixture.jsonl'), `${cloud.map((item) => JSON.stringify(item)).join('\n')}${cloud.length > 0 ? '\n' : ''}`, 'utf8'),
    writeFile(path.join(root, 'data', 'browser-materials', 'fixture.jsonl'), `${browser.map((item) => JSON.stringify(item)).join('\n')}${browser.length > 0 ? '\n' : ''}`, 'utf8'),
  ]);
}

export function fixtureMaterialsById() {
  return buildFixtureMaterialInput().materialById;
}
