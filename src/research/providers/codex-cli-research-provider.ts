import os from 'node:os';
import path from 'node:path';
import {
  CodexStructuredOutputError,
  CodexStructuredRunner,
  CodexStructuredRunnerError,
  CodexStructuredTimeoutError,
} from '../../local-agent/codex-structured-runner.js';
import { buildExperimentInput, buildResearchInput, EXPERIMENT_SYSTEM_PROMPT, RESEARCH_SYSTEM_PROMPT } from '../prompt.js';
import { experimentOutputSchema, researchProviderResultSchema } from '../schemas.js';
import {
  ResearchProviderTimeoutError,
  ResearchProviderUnavailableError,
  type ResearchExperimentInput,
  type ResearchProvider,
  type ResearchProviderCall,
  type ResearchProviderInput,
} from './research-provider.js';

export interface CodexCliResearchProviderOptions {
  binPath?: string;
  model: string;
  env?: NodeJS.ProcessEnv;
  tempRoot?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

function mapError(error: unknown): never {
  if (error instanceof CodexStructuredTimeoutError) throw new ResearchProviderTimeoutError();
  if (error instanceof CodexStructuredOutputError) throw new ResearchProviderUnavailableError('codex_output_invalid');
  if (error instanceof CodexStructuredRunnerError) throw new ResearchProviderUnavailableError(error.code);
  throw error;
}

export class CodexCliResearchProvider implements ResearchProvider {
  readonly providerName = 'codex_cli';
  readonly modelName: string;
  readonly runtimeVersion: string;
  readonly timeoutMs: number;

  private constructor(private readonly runner: CodexStructuredRunner, timeoutMs: number) {
    this.modelName = runner.modelName;
    this.runtimeVersion = runner.runtimeVersion;
    this.timeoutMs = timeoutMs;
  }

  static async create(options: CodexCliResearchProviderOptions): Promise<CodexCliResearchProvider> {
    try {
      const timeoutMs = options.timeoutMs ?? 5 * 60_000;
      return new CodexCliResearchProvider(await CodexStructuredRunner.create({
        ...(options.binPath === undefined ? {} : { binPath: options.binPath }),
        model: options.model,
        env: options.env ?? process.env,
        tempRoot: options.tempRoot ?? path.join(os.homedir(), 'Library', 'Application Support', 'AiAutoContent', 'tmp', 'research-provider'),
        timeoutMs,
        ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
      }), timeoutMs);
    } catch (error) {
      return mapError(error);
    }
  }

  private async researchCall(input: ResearchProviderInput, repairErrors: string[]): Promise<ResearchProviderCall<ReturnType<typeof researchProviderResultSchema.parse>>> {
    try {
      return await this.runner.run({
        label: repairErrors.length > 0 ? 'research-repair' : 'research',
        input: buildResearchInput({ ...input, repairErrors }),
        systemInstructions: RESEARCH_SYSTEM_PROMPT,
        outputSchema: researchProviderResultSchema,
      });
    } catch (error) {
      return mapError(error);
    }
  }

  analyze(input: ResearchProviderInput) {
    return this.researchCall(input, []);
  }

  repair(input: ResearchProviderInput, validationErrors: string[]) {
    return this.researchCall(input, validationErrors.slice(0, 20));
  }

  async runExperiment(input: ResearchExperimentInput) {
    try {
      return await this.runner.run({
        label: `experiment-${input.variant}`,
        input: buildExperimentInput(input),
        systemInstructions: EXPERIMENT_SYSTEM_PROMPT,
        outputSchema: experimentOutputSchema,
      });
    } catch (error) {
      return mapError(error);
    }
  }
}

export async function codexCliResearchProviderFromEnvironment(env = process.env): Promise<CodexCliResearchProvider> {
  const model = env.RESEARCH_CODEX_MODEL ?? env.TOPIC_CODEX_MODEL ?? '';
  if (model.trim() === '') throw new ResearchProviderUnavailableError('codex_non_interactive_unavailable');
  const configuredBin = env.RESEARCH_CODEX_BIN ?? env.TOPIC_CODEX_BIN;
  return CodexCliResearchProvider.create({
    ...(configuredBin === undefined ? {} : { binPath: configuredBin }),
    model,
    env,
  });
}
