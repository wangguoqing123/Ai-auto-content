import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { loadTopicIntelligenceConfig } from '../topic-intelligence/config.js';
import { buildTopicMaterialInput } from '../topic-intelligence/material-input.js';
import { readExistingTopicDecision } from '../topic-intelligence/storage.js';
import type { TopicCandidate } from '../topic-intelligence/schemas.js';
import { simpleWritingConfigSchema, type SimpleWritingConfig } from './schemas.js';

export interface SimpleWritingTopic {
  working_title: string;
  one_sentence_promise: string;
  target_segment: string;
  trigger_scenario: string;
  user_problem: string;
  wrong_current_behavior: string;
  real_task: string;
  minimum_result: string;
  core_angle: string;
  why_now: string;
  proof_format: string;
  fact_source_ids: string[];
  trend_signal_ids: string[];
  structure_inspiration_ids: string[];
  selected_material_ids: string[];
  topic_signature: string | null;
}

export type SimpleWritingSourceRole = 'fact_source' | 'trend_signal' | 'structure_inspiration';

export interface SimpleWritingMaterial {
  material_id: string;
  source_name: string;
  source_type: string;
  source_role: SimpleWritingSourceRole;
  title: string;
  published_at: string | null;
  canonical_url: string;
  excerpt: string;
  content_scope: string;
  source_status: string;
}

function isSimpleWritingSourceRole(value: string): value is SimpleWritingSourceRole {
  return value === 'fact_source' || value === 'trend_signal' || value === 'structure_inspiration';
}

export interface SimpleWritingInput {
  writing_date: string;
  topic: SimpleWritingTopic;
  materials: SimpleWritingMaterial[];
}

export type SimpleWritingInputResult =
  | { state: 'waiting_for_topic' }
  | { state: 'no_content' }
  | { state: 'ready'; input: SimpleWritingInput };

export class SimpleWritingInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SimpleWritingInputError';
  }
}

export async function loadSimpleWritingConfig(rootDir = process.cwd()): Promise<SimpleWritingConfig> {
  try {
    return simpleWritingConfigSchema.parse(parse(await readFile(
      path.join(rootDir, 'config', 'simple-writing.yaml'),
      'utf8',
    )) as unknown);
  } catch (error) {
    throw new SimpleWritingInputError('configuration_invalid', 'Simple Writing configuration is invalid.');
  }
}

function topicSnapshot(topic: TopicCandidate, maximumSources: number): SimpleWritingTopic {
  const selectedMaterialIds = [...new Set([
    ...topic.fact_source_ids,
    ...topic.trend_signal_ids,
    ...topic.structure_inspiration_ids,
  ])].slice(0, maximumSources);
  return {
    working_title: topic.working_title,
    one_sentence_promise: topic.one_sentence_promise,
    target_segment: topic.target_segment,
    trigger_scenario: topic.trigger_scenario,
    user_problem: topic.user_problem,
    wrong_current_behavior: topic.wrong_current_behavior,
    real_task: topic.real_task,
    minimum_result: topic.minimum_result,
    core_angle: topic.core_angle,
    why_now: topic.why_now,
    proof_format: topic.proof_format,
    fact_source_ids: topic.fact_source_ids,
    trend_signal_ids: topic.trend_signal_ids,
    structure_inspiration_ids: topic.structure_inspiration_ids,
    selected_material_ids: selectedMaterialIds,
    topic_signature: topic.topic_signature,
  };
}

export async function loadSimpleWritingInput(
  rootDir: string,
  writingDate: string,
): Promise<SimpleWritingInputResult> {
  const existing = await readExistingTopicDecision(rootDir, writingDate);
  if (existing.state === 'absent') return { state: 'waiting_for_topic' };
  if (existing.state === 'invalid' || existing.decision.status === 'failed') {
    throw new SimpleWritingInputError('topic_decision_invalid', 'Topic Decision is invalid or failed.');
  }
  if (existing.decision.decision === 'NO_PUBLISH') return { state: 'no_content' };
  const selected = existing.decision.selected_topic;
  if (selected === null) throw new SimpleWritingInputError('topic_decision_invalid', 'SELECT_TOPIC has no selected topic.');

  const [writingConfig, topicConfig] = await Promise.all([
    loadSimpleWritingConfig(rootDir),
    loadTopicIntelligenceConfig(rootDir),
  ]);
  const topic = topicSnapshot(selected, writingConfig.input.maximum_sources);
  const materialInput = await buildTopicMaterialInput(rootDir, writingDate, topicConfig);
  const materials = topic.selected_material_ids.flatMap((materialId): SimpleWritingMaterial[] => {
    const card = materialInput.materialById.get(materialId);
    if (card === undefined || card.canonical_url === null || card.excerpt.trim() === ''
      || !isSimpleWritingSourceRole(card.role)) return [];
    return [{
      material_id: card.material_id,
      source_name: card.author_name.trim() || card.source_platform,
      source_type: card.source_platform,
      source_role: card.role,
      title: card.title,
      published_at: card.published_at,
      canonical_url: card.canonical_url,
      excerpt: card.excerpt,
      content_scope: `${card.role}_persisted_excerpt`,
      source_status: card.restrictions.length === 0 ? 'resolved' : card.restrictions.join(';'),
    }];
  });
  return { state: 'ready', input: { writing_date: writingDate, topic, materials } };
}

const fixtureTopic: SimpleWritingTopic = {
  working_title: '把一次 AI 任务变成可以验收的最小流程',
  one_sentence_promise: '用输入、步骤和验收点，把模糊的 AI 建议变成可检查的结果。',
  target_segment: '已经接触 AI，但还没有稳定工作方法的人',
  trigger_scenario: '同类任务反复出现，每次仍然从一句模糊要求开始。',
  user_problem: 'AI 给了很多建议，但用户不知道什么才算真正完成。',
  wrong_current_behavior: '只保存提示词或答案，不保存输入条件和验收标准。',
  real_task: '选择一个真实小任务，写清输入、执行顺序和三个验收点。',
  minimum_result: '得到一张下一次可以直接复用并人工检查的任务卡。',
  core_angle: '从产品经理的目标和验收视角理解 AI 工作流。',
  why_now: '合成素材显示，明确的输入和检查点比继续追加空泛建议更有用。',
  proof_format: '一张合成任务卡和逐项验收清单',
  fact_source_ids: ['mat_111111111111'],
  trend_signal_ids: ['mat_222222222222'],
  structure_inspiration_ids: ['mat_333333333333'],
  selected_material_ids: ['mat_111111111111', 'mat_222222222222', 'mat_333333333333'],
  topic_signature: '1'.repeat(64),
};

const fixtureMaterial: SimpleWritingMaterial = {
  material_id: 'mat_111111111111',
  source_name: 'Simple Writing Fixture',
  source_type: 'rss',
  source_role: 'fact_source',
  title: 'Synthetic workflow guide with inputs, steps, and acceptance checks',
  published_at: '2026-08-13T02:00:00.000Z',
  canonical_url: 'https://example.com/synthetic-workflow-guide',
  excerpt: 'This synthetic fixture says a repeatable workflow records its inputs, ordered steps, and acceptance checks.',
  content_scope: 'fact_source_persisted_excerpt',
  source_status: 'resolved',
};

const fixtureTrendMaterial: SimpleWritingMaterial = {
  material_id: 'mat_222222222222',
  source_name: 'Synthetic Discussion Fixture',
  source_type: 'twitter',
  source_role: 'trend_signal',
  title: 'Synthetic discussion about unclear AI workflow acceptance criteria',
  published_at: '2026-08-13T03:00:00.000Z',
  canonical_url: 'https://example.com/synthetic-discussion-signal',
  excerpt: 'This synthetic discussion is one signal that some users struggle to define when an AI task is complete.',
  content_scope: 'trend_signal_persisted_excerpt',
  source_status: 'ugc_signal_only;no_velocity_claim',
};

const fixtureStructureMaterial: SimpleWritingMaterial = {
  material_id: 'mat_333333333333',
  source_name: 'Synthetic Structure Fixture',
  source_type: 'weixin',
  source_role: 'structure_inspiration',
  title: 'Synthetic article outline organized as problem, action, and acceptance check',
  published_at: '2026-08-13T04:00:00.000Z',
  canonical_url: 'https://example.com/synthetic-structure-reference',
  excerpt: 'This synthetic reference organizes a tutorial as problem, action sequence, acceptance checks, and boundaries.',
  content_scope: 'structure_inspiration_persisted_excerpt',
  source_status: 'resolved',
};

export type SimpleWritingFixtureScenario = 'ready' | 'no-publish' | 'waiting' | 'no-sources';

export function buildFixtureSimpleWritingInput(
  writingDate: string,
  scenario: SimpleWritingFixtureScenario = 'ready',
): SimpleWritingInputResult {
  if (scenario === 'waiting') return { state: 'waiting_for_topic' };
  if (scenario === 'no-publish') return { state: 'no_content' };
  return {
    state: 'ready',
    input: {
      writing_date: writingDate,
      topic: fixtureTopic,
      materials: scenario === 'no-sources'
        ? []
        : [fixtureMaterial, fixtureTrendMaterial, fixtureStructureMaterial],
    },
  };
}
