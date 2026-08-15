import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyResearchProviderResult } from '../src/research/claim-verification.js';
import { loadResearchIntelligenceConfig } from '../src/research/config.js';
import { buildFixtureResearchSources } from '../src/research/fixture.js';
import { FixtureResearchProvider } from '../src/research/providers/fixture-research-provider.js';
import { loadFactSourceMaterials } from '../src/research/source-materials.js';
import { topicDecisionSchema, type TopicCandidate } from '../src/topic-intelligence/schemas.js';
import type { CleanedSourceSnapshot, ResearchIntelligenceConfig, ResearchProviderResult } from '../src/research/schemas.js';

let topic: TopicCandidate;
let sources: CleanedSourceSnapshot[];
let config: ResearchIntelligenceConfig;
let valid: ResearchProviderResult;

beforeAll(async () => {
  const decision = topicDecisionSchema.parse(JSON.parse(await readFile(
    path.join(process.cwd(), 'data', 'topic-decisions', '2026-08-14.json'), 'utf8',
  )) as unknown);
  topic = decision.selected_topic!;
  config = await loadResearchIntelligenceConfig(process.cwd());
  sources = buildFixtureResearchSources(await loadFactSourceMaterials(process.cwd(), decision, 5));
  valid = (await new FixtureResearchProvider().analyze({
    decisionDate: decision.decision_date, topic, sources, productSummary: {}, experimentTasks: [], config,
  })).output;
});

function errors(result: ResearchProviderResult, selectedTopic = topic, selectedSources = sources, selectedConfig = config) {
  return verifyResearchProviderResult({ result, topic: selectedTopic, sources: selectedSources, config: selectedConfig }).errors;
}

describe('research claim and answer verification', () => {
  it('accepts exact quotes from the declared fact sources', () => {
    expect(errors(structuredClone(valid))).toEqual([]);
  });

  it('rejects an unknown source_id', () => {
    const result = structuredClone(valid);
    result.verified_claims[0]!.source_id = 'source_ffffffffffff';
    expect(errors(result)).toContain('unknown source_id: source_ffffffffffff');
  });

  it('rejects an unknown segment_id', () => {
    const result = structuredClone(valid);
    result.verified_claims[0]!.segment_id = 'p9999';
    expect(errors(result)).toContain('unknown segment_id: p9999');
  });

  it('rejects a fabricated quote', () => {
    const result = structuredClone(valid);
    result.verified_claims[0]!.quote = 'meaning is similar but this text is not present';
    expect(errors(result)).toContain('quote is not an exact segment substring: claim_supported_1');
  });

  it('rejects a quote over the configured single-quote cap', () => {
    const result = structuredClone(valid);
    const selectedConfig = structuredClone(config);
    selectedConfig.source_fetch.maximum_single_quote_chars = 10;
    expect(errors(result, topic, sources, selectedConfig)).toContain('quote exceeds single quote limit: claim_supported_1');
  });

  it('treats a partial time-sensitive claim as an evidence gap, not a structural error', () => {
    const result = structuredClone(valid);
    result.verified_claims[0]!.support_status = 'partial';
    result.verified_claims[0]!.scope_limit = 'Only the official RSS excerpt is supported; the full article is unavailable.';
    expect(errors(result)).toEqual([]);
  });

  it('allows partial non-time-sensitive claims only with a scope limit at schema level', () => {
    const selectedTopic = structuredClone(topic);
    selectedTopic.time_sensitive = false;
    const result = structuredClone(valid);
    result.verified_claims[0]!.support_status = 'partial';
    result.verified_claims[0]!.scope_limit = 'Limited to the official RSS excerpt; full article details are unavailable.';
    expect(errors(result, selectedTopic)).toEqual([]);
  });

  it('rejects a missing declared supported claim', () => {
    const result = structuredClone(valid);
    result.verified_claims = result.verified_claims.slice(1);
    expect(errors(result)).toContain('missing declared supported claim: claim_supported_1');
  });

  it('rejects duplicate claim IDs', () => {
    const result = structuredClone(valid);
    result.verified_claims[1]!.claim_id = result.verified_claims[0]!.claim_id;
    expect(errors(result)).toContain('duplicate claim_id: claim_supported_1');
  });

  it('rejects an answer that references an unknown claim', () => {
    const result = structuredClone(valid);
    result.research_answers[0]!.supporting_claim_ids = ['claim_missing'];
    expect(errors(result)).toContain('answer references unknown claim: claim_missing');
  });

  it('allows the non-factual experiment task-selection question without a source claim', () => {
    const result = structuredClone(valid);
    result.research_answers[2] = {
      question: topic.research_questions[2]!, answer_status: 'answered', gap_impact: 'none',
      answer: 'Use the bounded project-owned synthetic text task.', supporting_claim_ids: [], remaining_gap: '',
    };
    expect(errors(result)).toEqual([]);
  });

  it('rejects a factual answered question without a verified claim', () => {
    const result = structuredClone(valid);
    result.research_answers[0] = {
      question: topic.research_questions[0]!, answer_status: 'answered', gap_impact: 'none',
      answer: 'Unsupported factual answer.', supporting_claim_ids: [], remaining_gap: '',
    };
    expect(errors(result)).toContain(`factual answered question lacks a verified claim: ${topic.research_questions[0]}`);
  });

  it('treats an answer reference to an unsupported claim as an evidence gap', () => {
    const result = structuredClone(valid);
    result.verified_claims[0]!.support_status = 'unsupported';
    result.verified_claims[0]!.source_id = null;
    result.verified_claims[0]!.segment_id = null;
    result.verified_claims[0]!.quote = '';
    expect(errors(result)).toEqual([]);
  });

  it('rejects a numeric answer detail absent from its supporting evidence', () => {
    const result = structuredClone(valid);
    result.research_answers[0]!.answer = 'The result improved by 47%.';
    expect(errors(result)).toContain('answer contains unsupported numeric token: 47%');
  });

  it('rejects a missing research question', () => {
    const result = structuredClone(valid);
    result.research_answers.pop();
    expect(errors(result)).toEqual(expect.arrayContaining([
      'research answer count does not match Topic Decision',
      `missing research question: ${topic.research_questions[2]}`,
    ]));
  });

  it('rejects a writing requirement that references an unsupported claim', () => {
    const result = structuredClone(valid);
    result.writing_requirements.required_claim_ids = ['claim_missing'];
    expect(errors(result)).toContain('writing requirements reference unknown claim: claim_missing');
  });

  it('requires an explicit full-article limitation for a feed excerpt claim', () => {
    const result = structuredClone(valid);
    result.verified_claims[0]!.scope_limit = '';
    expect(errors(result)).toContain('feed excerpt claim lacks explicit scope limitation: claim_supported_1');
  });

  it('rejects a feed excerpt claim number absent from the exact quote', () => {
    const result = structuredClone(valid);
    result.verified_claims[0]!.claim = `${result.verified_claims[0]!.claim} 47%`;
    expect(errors(result)).toContain('claim contains unsupported numeric token: 47%');
  });

  it('requires an experiment task when Topic Decision requires one', () => {
    const result = structuredClone(valid);
    result.experiment_task_id = null;
    expect(errors(result)).toContain('required experiment task was not selected');
  });

  it('rejects an experiment when Topic Decision does not require one', () => {
    const selectedTopic = structuredClone(topic);
    selectedTopic.requires_experiment = false;
    expect(errors(structuredClone(valid), selectedTopic)).toContain('experiment selected when Topic Decision does not require one');
  });

  it('rejects aggregate quotes over the per-source cap', () => {
    const selectedSources = structuredClone(sources);
    selectedSources[0]!.segments[0]!.text = 'x'.repeat(500);
    const result = structuredClone(valid);
    result.verified_claims = [0, 1, 2, 3].map((index) => ({
      ...result.verified_claims[0]!, claim_id: `claim_supported_${index + 1}`, quote: 'x'.repeat(400),
    }));
    const selectedTopic = structuredClone(topic);
    selectedTopic.supported_claims = result.verified_claims.map((claim) => ({ claim: claim.claim, fact_source_ids: [sources[0]!.material_id] }));
    expect(errors(result, selectedTopic, selectedSources)).toContain(`source quote total exceeds limit: ${sources[0]!.source_id}`);
  });
});
