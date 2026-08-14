import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  noPublishReasonCodeSchema,
  topicDecisionSchema,
  evidenceReferenceSchema,
  topicIntelligenceConfigSchema,
  topicMaterialCardSchema,
} from '../src/topic-intelligence/schemas.js';
import { topicConfig } from './topic-test-helpers.js';

describe('topic intelligence strict schemas', () => {
  it('loads the committed configuration', async () => {
    await expect(topicConfig()).resolves.toMatchObject({ version: 1, timezone: 'Asia/Shanghai' });
  });

  it.each([
    ['input.lookback_hours', 0],
    ['input.lookback_hours', 169],
    ['input.max_total_materials', 61],
    ['input.max_cloud_materials', 31],
    ['input.max_twitter_materials', 26],
    ['input.max_weixin_resolved_materials', 9],
    ['input.max_weixin_restricted_materials', 9],
    ['input.max_per_author', 6],
    ['input.max_per_query', 11],
    ['input.max_per_cluster', 6],
    ['input.excerpt_max_chars', 501],
    ['input.restricted_excerpt_max_chars', 301],
    ['input.max_model_input_chars', 80001],
    ['candidates.maximum', 4],
    ['candidates.approval_score', 79],
    ['candidates.close_score_tie_range', 4],
    ['history.token_similarity_threshold', 0.91],
    ['model.maximum_calls_per_run', 3],
    ['model.repair_attempts', 2],
    ['output.maximum_supported_claims', 6],
  ])('rejects out-of-range %s=%s', async (field, value) => {
    const config = structuredClone(await topicConfig()) as Record<string, unknown>;
    const [group = '', name = ''] = field.split('.');
    (config[group] as Record<string, unknown>)[name] = value;
    expect(topicIntelligenceConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects extra config properties', async () => {
    expect(topicIntelligenceConfigSchema.safeParse({ ...(await topicConfig()), extra: true }).success).toBe(false);
  });

  it('fixes all eight NO_PUBLISH reason codes', () => {
    expect(noPublishReasonCodeSchema.options).toHaveLength(8);
  });

  it('rejects extra material card properties', () => {
    expect(topicMaterialCardSchema.safeParse({ extra: 'secret' }).success).toBe(false);
  });

  it.each(['invented', 'material:../secret', 'material:', 'material:mat:extra'])('rejects malformed evidence reference %s', (reference) => {
    expect(evidenceReferenceSchema.safeParse(reference).success).toBe(false);
  });

  it.each([
    ['SELECT_TOPIC', null, null, null],
    ['NO_PUBLISH', null, null, null],
  ])('rejects invalid success invariant for %s', async (decision, selected, code, reason) => {
    const raw = JSON.parse(await readFile(path.join(process.cwd(), 'tests', 'fixtures', 'cloud-material.json'), 'utf8')) as unknown;
    expect(raw).toBeTruthy();
    const base = {
      version: 1, decision_date: '2026-08-14', run_id: 'topic_2026-08-14T00-00-00-000Z',
      status: 'success', decision, prompt_version: 'topic-intelligence-v1', input_hash: '0'.repeat(64),
      input_summary: {
        total_before_filter: 0, eligible_total: 0, total_after_filter: 0, cloud_count: 0, twitter_count: 0,
        weixin_resolved_count: 0, restricted_count: 0, fact_source_count: 0, trend_signal_count: 0,
        structure_inspiration_count: 0,
        eligible_by_bucket: { cloud: 0, twitter: 0, weixin_resolved: 0, weixin_restricted: 0 },
        selected_by_bucket: { cloud: 0, twitter: 0, weixin_resolved: 0, weixin_restricted: 0 },
        dropped_by_reason: {
          duplicate: 0, outside_window: 0, invalid_status: 0, invalid_url: 0, invalid_material: 0,
          sensitive_content: 0, author_limit: 0, query_limit: 0, cluster_limit: 0, bucket_limit: 0, character_limit: 0,
        },
        source_gaps: [],
      },
      selected_topic: selected, evaluated_candidates: [], no_publish_reason_code: code, no_publish_reason: reason,
      model: { provider: 'fixture', model: 'offline', calls: 0, duration_ms: 0, usage: null },
      error_code: null, error_message_safe: null, created_at: '2026-08-14T00:00:00.000Z',
    };
    expect(topicDecisionSchema.safeParse(base).success).toBe(false);
  });

  it('committed YAML parses without aliases or code execution', async () => {
    const text = await readFile(path.join(process.cwd(), 'config', 'topic-intelligence.yaml'), 'utf8');
    expect(topicIntelligenceConfigSchema.parse(parse(text))).toMatchObject({ candidates: { maximum: 3, approval_score: 80 } });
  });
});
