import type { TopicHistoryEntry } from '../history.js';
import type { TopicProductContext } from '../product-context.js';
import type { TopicIntelligenceConfig, TopicMaterialCard } from '../schemas.js';

export interface TopicJudgeInput {
  decisionDate: string;
  materials: TopicMaterialCard[];
  productContext: TopicProductContext;
  recentTopics: TopicHistoryEntry[];
  config: Pick<TopicIntelligenceConfig, 'candidates' | 'output'>;
}

export interface TopicJudgeUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
}

export interface TopicJudgeProviderCall {
  output: unknown;
  durationMs: number;
  usage: TopicJudgeUsage | null;
}

export interface TopicJudgeProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly runtimeVersion?: string | null;
  readonly outputSchemaVersion?: string | null;
  judge(input: TopicJudgeInput): Promise<TopicJudgeProviderCall>;
  repair(input: TopicJudgeInput, validationErrors: string[]): Promise<TopicJudgeProviderCall>;
}

export const TOPIC_JUDGE_OUTPUT_SCHEMA_VERSION = 'topic-judge-provider-v1';

export class TopicJudgeUnavailableError extends Error {
  constructor(message = 'Topic judge provider unavailable') {
    super(message);
    this.name = 'TopicJudgeUnavailableError';
  }
}

export class TopicJudgeTimeoutError extends Error {
  constructor(message = 'Topic judge provider timed out') {
    super(message);
    this.name = 'TopicJudgeTimeoutError';
  }
}
