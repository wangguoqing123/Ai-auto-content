import type { TopicCandidate } from '../topic-intelligence/schemas.js';
import type {
  CleanedSourceSnapshot,
  ResearchIntelligenceConfig,
  ResearchProviderResult,
} from './schemas.js';

export interface VerifiedResearchProviderResult {
  result: ResearchProviderResult;
  errors: string[];
}

function numericTokens(value: string): string[] {
  return value.match(/\b\d[\d,]*(?:\.\d+)?%?/g) ?? [];
}

export function verifyResearchProviderResult(input: {
  result: ResearchProviderResult;
  topic: TopicCandidate;
  sources: CleanedSourceSnapshot[];
  config: ResearchIntelligenceConfig;
}): VerifiedResearchProviderResult {
  const errors: string[] = [];
  const sources = new Map(input.sources.map((source) => [source.source_id, source]));
  const claimIds = new Set<string>();
  const committedBySource = new Map<string, number>();
  for (const claim of input.result.verified_claims) {
    if (claimIds.has(claim.claim_id)) errors.push(`duplicate claim_id: ${claim.claim_id}`);
    claimIds.add(claim.claim_id);
    if (claim.support_status === 'unsupported') continue;
    const source = claim.source_id === null ? undefined : sources.get(claim.source_id);
    if (source === undefined) {
      errors.push(`unknown source_id: ${claim.source_id ?? 'null'}`);
      continue;
    }
    const segment = source.segments.find(({ segment_id }) => segment_id === claim.segment_id);
    if (segment === undefined) {
      errors.push(`unknown segment_id: ${claim.segment_id ?? 'null'}`);
      continue;
    }
    if (claim.quote.length > input.config.source_fetch.maximum_single_quote_chars) {
      errors.push(`quote exceeds single quote limit: ${claim.claim_id}`);
    }
    if (!segment.text.includes(claim.quote)) errors.push(`quote is not an exact segment substring: ${claim.claim_id}`);
    for (const token of numericTokens(claim.claim)) {
      if (!claim.quote.includes(token)) errors.push(`claim contains unsupported numeric token: ${token}`);
    }
    if (source.content_scope === 'feed_excerpt') {
      const scope = claim.scope_limit.toLocaleLowerCase();
      if (scope === '' || !/(rss|feed|摘要|excerpt)/.test(scope) || !/(full|article|全文|完整)/.test(scope)) {
        errors.push(`feed excerpt claim lacks explicit scope limitation: ${claim.claim_id}`);
      }
    }
    const committed = (committedBySource.get(source.source_id) ?? 0) + claim.quote.length;
    committedBySource.set(source.source_id, committed);
    if (committed > input.config.source_fetch.maximum_committed_quote_chars_per_source) {
      errors.push(`source quote total exceeds limit: ${source.source_id}`);
    }
  }
  for (let index = 0; index < input.topic.supported_claims.length; index += 1) {
    const id = `claim_supported_${index + 1}`;
    const claim = input.result.verified_claims.find((item) => item.claim_id === id);
    if (claim === undefined) errors.push(`missing declared supported claim: ${id}`);
    else if (claim.support_status !== 'unsupported') {
      const source = claim.source_id === null ? undefined : sources.get(claim.source_id);
      if (source !== undefined && !input.topic.supported_claims[index]!.fact_source_ids.includes(source.material_id)) {
        errors.push(`declared claim cites an unassigned fact source: ${id}`);
      }
    }
  }
  const expectedQuestions = input.topic.research_questions;
  if (input.result.research_answers.length !== expectedQuestions.length) errors.push('research answer count does not match Topic Decision');
  for (const question of expectedQuestions) {
    const answer = input.result.research_answers.find((item) => item.question === question);
    if (answer === undefined) {
      errors.push(`missing research question: ${question}`);
      continue;
    }
    if (answer.answer_status === 'answered' && answer.supporting_claim_ids.length === 0) {
      const experimentDesignQuestion = input.topic.requires_experiment
        && input.result.experiment_task_id !== null
        && /(?:选择.{0,20}(?:任务|实验|演示)|什么.{0,20}(?:任务|实验|演示)|哪(?:个|种).{0,20}(?:任务|实验|演示)|(?:which|what|select).{0,30}(?:task|experiment|demonstrat))/iu.test(question);
      if (!experimentDesignQuestion) errors.push(`factual answered question lacks a verified claim: ${question}`);
    }
    for (const claimId of answer.supporting_claim_ids) {
      const claim = input.result.verified_claims.find((item) => item.claim_id === claimId);
      if (claim === undefined) errors.push(`answer references unknown claim: ${claimId}`);
    }
    const supportingText = answer.supporting_claim_ids
      .map((claimId) => input.result.verified_claims.find((item) => item.claim_id === claimId))
      .filter((claim): claim is ResearchProviderResult['verified_claims'][number] =>
        claim !== undefined && claim.support_status !== 'unsupported')
      .map((claim) => `${claim.claim}\n${claim.quote}`)
      .join('\n');
    for (const token of numericTokens(answer.answer)) {
      if (!supportingText.includes(token)) errors.push(`answer contains unsupported numeric token: ${token}`);
    }
  }
  for (const claimId of input.result.writing_requirements.required_claim_ids) {
    const claim = input.result.verified_claims.find((item) => item.claim_id === claimId);
    if (claim === undefined) errors.push(`writing requirements reference unknown claim: ${claimId}`);
  }
  if (input.topic.requires_experiment && input.result.experiment_task_id === null) errors.push('required experiment task was not selected');
  if (!input.topic.requires_experiment && input.result.experiment_task_id !== null) errors.push('experiment selected when Topic Decision does not require one');
  return { result: input.result, errors: [...new Set(errors)] };
}
