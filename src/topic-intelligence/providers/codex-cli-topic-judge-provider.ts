import os from 'node:os';
import path from 'node:path';
import {
  CodexStructuredOutputError,
  CodexStructuredRunner,
  CodexStructuredRunnerError,
  CodexStructuredTimeoutError,
  codexStructuredErrorCodes,
  type CodexProcessRunner,
  type CodexStructuredCapabilities,
} from '../../local-agent/codex-structured-runner.js';
import { buildTopicJudgeData, TOPIC_JUDGE_SYSTEM_PROMPT } from '../prompt.js';
import { topicJudgeProviderResultSchema } from '../schemas.js';
import {
  TOPIC_JUDGE_OUTPUT_SCHEMA_VERSION,
  TopicJudgeTimeoutError,
  TopicJudgeUnavailableError,
  type TopicJudgeInput,
  type TopicJudgeProvider,
  type TopicJudgeProviderCall,
  type TopicJudgeUsage,
} from './topic-judge-provider.js';

export const codexCliErrorCodes = codexStructuredErrorCodes;
export type CodexCliErrorCode = typeof codexCliErrorCodes[number];
export type CodexCliCapabilities = CodexStructuredCapabilities;

export class CodexCliProviderError extends TopicJudgeUnavailableError {
  constructor(readonly code: Exclude<CodexCliErrorCode, 'codex_timeout' | 'codex_output_invalid'>) {
    super(code);
    this.name = 'CodexCliProviderError';
  }
}

export interface CodexCliTopicJudgeProviderOptions {
  binPath?: string;
  model: string;
  tempRoot?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  processRunner?: CodexProcessRunner;
}

function invalidOutput(durationMs: number, usage: TopicJudgeUsage | null): TopicJudgeProviderCall {
  return { output: { __provider_error: 'codex_output_invalid' }, durationMs, usage };
}

function mapCreationError(error: unknown): never {
  if (error instanceof CodexStructuredTimeoutError) throw new TopicJudgeTimeoutError('codex_timeout');
  if (error instanceof CodexStructuredRunnerError) throw new CodexCliProviderError(error.code);
  throw error;
}

export class CodexCliTopicJudgeProvider implements TopicJudgeProvider {
  readonly providerName = 'codex_cli';
  readonly modelName: string;
  readonly runtimeVersion: string;
  readonly outputSchemaVersion = TOPIC_JUDGE_OUTPUT_SCHEMA_VERSION;
  readonly capabilities: CodexCliCapabilities;

  private constructor(private readonly runner: CodexStructuredRunner) {
    this.capabilities = runner.capabilities;
    this.runtimeVersion = runner.runtimeVersion;
    this.modelName = runner.modelName;
  }

  static async create(options: CodexCliTopicJudgeProviderOptions): Promise<CodexCliTopicJudgeProvider> {
    try {
      return new CodexCliTopicJudgeProvider(await CodexStructuredRunner.create({
        ...(options.binPath === undefined ? {} : { binPath: options.binPath }),
        model: options.model,
        tempRoot: options.tempRoot ?? path.join(os.homedir(), 'Library', 'Application Support', 'AiAutoContent', 'tmp', 'topic-judge'),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.processRunner === undefined ? {} : { processRunner: options.processRunner }),
      }));
    } catch (error) {
      return mapCreationError(error);
    }
  }

  private async call(input: TopicJudgeInput, repairErrors: string[]): Promise<TopicJudgeProviderCall> {
    try {
      const call = await this.runner.run({
        label: 'topic',
        input: JSON.parse(buildTopicJudgeData(input, repairErrors)) as unknown,
        systemInstructions: TOPIC_JUDGE_SYSTEM_PROMPT,
        outputSchema: topicJudgeProviderResultSchema,
      });
      return { output: call.output, durationMs: call.durationMs, usage: call.usage };
    } catch (error) {
      if (error instanceof CodexStructuredOutputError) return invalidOutput(error.durationMs, error.usage);
      if (error instanceof CodexStructuredTimeoutError) throw new TopicJudgeTimeoutError('codex_timeout');
      if (error instanceof CodexStructuredRunnerError) throw new CodexCliProviderError(error.code);
      throw error;
    }
  }

  judge(input: TopicJudgeInput): Promise<TopicJudgeProviderCall> {
    return this.call(input, []);
  }

  repair(input: TopicJudgeInput, validationErrors: string[]): Promise<TopicJudgeProviderCall> {
    return this.call(input, validationErrors.slice(0, 20));
  }
}

export async function codexCliProviderFromEnvironment(env: NodeJS.ProcessEnv = process.env): Promise<CodexCliTopicJudgeProvider> {
  return CodexCliTopicJudgeProvider.create({
    ...(env.TOPIC_CODEX_BIN === undefined ? {} : { binPath: env.TOPIC_CODEX_BIN }),
    model: env.TOPIC_CODEX_MODEL ?? '',
    env,
  });
}
