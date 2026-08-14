import type { TopicCandidate } from '../../topic-intelligence/schemas.js';
import type {
  CleanedSourceSnapshot,
  ExperimentCatalogTask,
  ExperimentOutput,
  ResearchIntelligenceConfig,
  ResearchProviderResult,
} from '../schemas.js';

export interface ResearchProviderInput {
  decisionDate: string;
  topic: TopicCandidate;
  sources: CleanedSourceSnapshot[];
  productSummary: unknown;
  experimentTasks: ExperimentCatalogTask[];
  config: ResearchIntelligenceConfig;
}

export interface ResearchExperimentInput {
  variant: 'baseline_chat_request' | 'structured_task_card';
  task: ExperimentCatalogTask;
}

export interface ResearchProviderCall<T> {
  output: T;
  durationMs: number;
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  } | null;
}

export interface ResearchProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly runtimeVersion: string | null;
  readonly timeoutMs: number;
  analyze(input: ResearchProviderInput): Promise<ResearchProviderCall<ResearchProviderResult>>;
  repair(input: ResearchProviderInput, validationErrors: string[]): Promise<ResearchProviderCall<ResearchProviderResult>>;
  runExperiment(input: ResearchExperimentInput): Promise<ResearchProviderCall<ExperimentOutput>>;
}

export class ResearchProviderUnavailableError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ResearchProviderUnavailableError';
  }
}

export class ResearchProviderTimeoutError extends Error {
  constructor() {
    super('codex_timeout');
    this.name = 'ResearchProviderTimeoutError';
  }
}
