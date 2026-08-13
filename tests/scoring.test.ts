import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load-config.js';
import { normalizeFeedItem } from '../src/processors/normalize.js';
import {
  scoreEvidence,
  scoreFreshness,
  scoreMaterial,
  scoreRelevance,
} from '../src/processors/score-material.js';
import type { ScoringConfig } from '../src/types.js';
import { makeRawItem, makeSource } from './helpers.js';

let config: ScoringConfig;
const now = new Date('2026-08-12T12:00:00.000Z');

beforeAll(async () => {
  config = (await loadConfig(process.cwd())).scoring;
});

describe('deterministic scoring', () => {
  it('scores freshness at the configured boundaries', () => {
    expect(scoreFreshness('2026-08-12T00:00:00.000Z', now, config)).toBe(100);
    expect(scoreFreshness('2026-08-10T00:00:00.000Z', now, config)).toBe(80);
    expect(scoreFreshness('2026-08-06T00:00:00.000Z', now, config)).toBe(60);
    expect(scoreFreshness('2026-07-30T00:00:00.000Z', now, config)).toBe(40);
    expect(scoreFreshness('2026-07-01T00:00:00.000Z', now, config)).toBe(10);
    expect(scoreFreshness(null, now, config)).toBe(10);
  });

  it('maps source tiers to evidence scores', () => {
    expect(scoreEvidence('primary', config)).toBe(100);
    expect(scoreEvidence('secondary', config)).toBe(70);
    expect(scoreEvidence('unverified', config)).toBe(30);
  });

  it('rewards beginner tasks and penalizes low-level research', () => {
    const practical = normalizeFeedItem(makeRawItem(), makeSource(), now.toISOString(), 500);
    const research = normalizeFeedItem(makeRawItem({
      title: 'Parameter benchmark and architecture ablation',
      excerpt: 'Weights, pretraining, arXiv theorem and benchmark details.',
    }), makeSource({ category: 'research', audience_fit: ['intermediate_user'] }), now.toISOString(), 500);
    expect(practical).not.toBeNull();
    expect(research).not.toBeNull();
    expect(scoreRelevance(practical!, config).score).toBeGreaterThanOrEqual(50);
    expect(scoreRelevance(research!, config).score).toBeLessThan(50);
    expect(scoreMaterial(practical!, config, now).status).toBe('accepted');
    expect(scoreMaterial(research!, config, now).rejectionReasons).toContain('low_level_only');
  });

  it('uses English word boundaries for short keywords', () => {
    const candidate = normalizeFeedItem(makeRawItem({
      title: 'Network mapping and encoder changes',
      excerpt: 'A networking mapper and encoded payload.',
    }), makeSource(), now.toISOString(), 500);
    expect(candidate).not.toBeNull();
    const result = scoreRelevance(candidate!, config);
    expect(result.tags).not.toContain('work_task');
    expect(result.tags).not.toContain('ai_coding');
  });

  it('does not credit the same keyword in multiple groups', () => {
    const candidate = normalizeFeedItem(makeRawItem({
      title: 'Workflow patterns',
      excerpt: 'One workflow.',
    }), makeSource({ category: 'research', audience_fit: ['intermediate_user'] }), now.toISOString(), 500);
    expect(candidate).not.toBeNull();
    const result = scoreRelevance(candidate!, config);
    expect(result.tags).toContain('work_task');
    expect(result.tags).not.toContain('automation');
  });
});
