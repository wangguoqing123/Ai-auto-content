import { performance } from 'node:perf_hooks';
import path from 'node:path';
import {
  buildFixtureSimpleWritingInput,
  loadSimpleWritingConfig,
  loadSimpleWritingInput,
  SimpleWritingInputError,
  type SimpleWritingFixtureScenario,
  type SimpleWritingInput,
  type SimpleWritingInputResult,
} from './input.js';
import { runSimpleWritingChecks } from './checks.js';
import {
  CodexCliSimpleWritingProvider,
  FixtureSimpleWritingProvider,
  SimpleWritingProviderError,
  simpleWritingProviderSettingsFromEnvironment,
  type SimpleWritingProvider,
} from './provider.js';
import {
  resolveSimpleWritingOutputDirectory,
  writeSimpleWritingSuccessFiles,
  type SimpleWritingOutputFiles,
} from './storage.js';
import {
  simpleWriterOutputSchema,
  simpleWritingPackSchema,
  type SimpleWritingPack,
} from './schemas.js';

export interface RunSimpleWritingBuildOptions {
  rootDir: string;
  writingDate: string;
  fixture?: boolean;
  fixtureScenario?: SimpleWritingFixtureScenario;
  dryRun?: boolean;
  outputRoot?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

export interface RunSimpleWritingBuildResult {
  pack: SimpleWritingPack;
  files_written: boolean;
  output_directory: string | null;
  files: SimpleWritingOutputFiles | null;
}

export interface SimpleWritingPipelineDependencies {
  loadInput?: (rootDir: string, writingDate: string) => Promise<SimpleWritingInputResult>;
  createProvider?: () => Promise<SimpleWritingProvider> | SimpleWritingProvider;
  beforeProviderCall?: () => Promise<void>;
  resolveOutputDirectory?: typeof resolveSimpleWritingOutputDirectory;
  writeSuccessFiles?: typeof writeSimpleWritingSuccessFiles;
}

function runId(writingDate: string, now: Date): string {
  return `simple_${writingDate.replaceAll('-', '')}_${now.toISOString().replace(/[-:.]/g, '')}`;
}

function packBase(options: {
  writingDate: string;
  now: Date;
  input?: SimpleWritingInput;
}): Omit<SimpleWritingPack, 'status' | 'decision' | 'output' | 'checks' | 'error_code' | 'error_message_safe'> {
  return {
    version: 1,
    writing_date: options.writingDate,
    run_id: runId(options.writingDate, options.now),
    topic: options.input === undefined ? null : {
      working_title: options.input.topic.working_title,
      topic_signature: options.input.topic.topic_signature,
    },
    input_summary: {
      source_count: options.input?.materials.length ?? 0,
      source_ids: options.input?.materials.map(({ material_id }) => material_id) ?? [],
    },
    model: {
      provider: 'not_called',
      model: '',
      runtime_version: null,
      calls: 0,
      duration_ms: 0,
      usage: null,
    },
    human_gate: {
      required: true,
      status: 'unreviewed',
      automated_publish_allowed: false,
    },
    created_at: options.now.toISOString(),
  };
}

function validated(pack: SimpleWritingPack): SimpleWritingPack {
  return simpleWritingPackSchema.parse(pack);
}

function noModelResult(pack: SimpleWritingPack): RunSimpleWritingBuildResult {
  return { pack: validated(pack), files_written: false, output_directory: null, files: null };
}

function providerFailureCode(error: unknown): string {
  return error instanceof SimpleWritingProviderError ? error.code : 'writer_failed';
}

async function defaultProvider(
  options: RunSimpleWritingBuildOptions,
): Promise<SimpleWritingProvider> {
  if (options.fixture === true) return new FixtureSimpleWritingProvider();
  const config = await loadSimpleWritingConfig(options.rootDir);
  const settings = simpleWritingProviderSettingsFromEnvironment(options.env ?? process.env, config.model.default_model);
  return CodexCliSimpleWritingProvider.create({
    ...settings,
    env: options.env ?? process.env,
    timeoutMs: config.model.timeout_ms,
  });
}

export async function runSimpleWritingBuild(
  options: RunSimpleWritingBuildOptions,
  dependencies: SimpleWritingPipelineDependencies = {},
): Promise<RunSimpleWritingBuildResult> {
  const now = options.now ?? new Date();
  let inputResult: SimpleWritingInputResult;
  try {
    inputResult = options.fixture === true
      ? buildFixtureSimpleWritingInput(options.writingDate, options.fixtureScenario ?? 'ready')
      : await (dependencies.loadInput ?? loadSimpleWritingInput)(options.rootDir, options.writingDate);
  } catch (error) {
    const code = error instanceof SimpleWritingInputError ? error.code : 'input_load_failed';
    const pack: SimpleWritingPack = {
      ...packBase({ writingDate: options.writingDate, now }),
      status: 'failed',
      decision: null,
      output: null,
      checks: null,
      error_code: code,
      error_message_safe: error instanceof SimpleWritingInputError
        ? error.message
        : 'Simple Writing input could not be loaded.',
    };
    return noModelResult(pack);
  }

  if (inputResult.state === 'waiting_for_topic') {
    return noModelResult({
      ...packBase({ writingDate: options.writingDate, now }),
      status: 'success', decision: 'WAITING_FOR_TOPIC', output: null, checks: null,
      error_code: null, error_message_safe: null,
    });
  }
  if (inputResult.state === 'no_content') {
    return noModelResult({
      ...packBase({ writingDate: options.writingDate, now }),
      status: 'success', decision: 'NO_CONTENT', output: null, checks: null,
      error_code: null, error_message_safe: null,
    });
  }

  const input = inputResult.input;
  const base = packBase({ writingDate: options.writingDate, now, input });
  if (input.materials.length === 0) {
    return noModelResult({
      ...base,
      status: 'success', decision: 'BLOCKED_NO_SOURCES', output: null, checks: null,
      error_code: null, error_message_safe: null,
    });
  }

  try {
    await dependencies.beforeProviderCall?.();
  } catch {
    return noModelResult({
      ...base,
      status: 'failed',
      decision: null,
      output: null,
      checks: null,
      error_code: 'attempt_state_write_failed',
      error_message_safe: 'Writer was not called because its daily attempt state could not be saved.',
    });
  }
  const attemptedAt = performance.now();
  let providerName = options.fixture === true ? 'fixture' : 'codex_cli';
  let modelName = options.fixture === true ? 'offline-fixture' : '';
  let runtimeVersion: string | null = options.fixture === true ? 'fixture-v1' : null;
  try {
    const provider = await (dependencies.createProvider ?? (() => defaultProvider(options)))();
    providerName = provider.providerName;
    modelName = provider.modelName;
    runtimeVersion = provider.runtimeVersion;
    const call = await provider.write(input);
    const checks = runSimpleWritingChecks(call.output, input);
    const parsed = simpleWriterOutputSchema.safeParse(call.output);
    const model = {
      provider: providerName,
      model: modelName,
      runtime_version: runtimeVersion,
      calls: 1 as const,
      duration_ms: Math.max(0, Math.round(call.durationMs)),
      usage: call.usage,
    };
    if (!parsed.success || checks.hard_failures.length > 0) {
      return noModelResult({
        ...base,
        status: 'failed',
        decision: null,
        output: parsed.success ? parsed.data : null,
        checks,
        model,
        error_code: checks.hard_failures[0]?.code ?? 'writer_output_invalid',
        error_message_safe: 'Writer output failed Simple Writing checks.',
      });
    }
    const pack = validated({
      ...base,
      status: 'success',
      decision: 'READY_FOR_HUMAN_REVIEW',
      output: parsed.data,
      checks,
      model,
      error_code: null,
      error_message_safe: null,
    });
    try {
      const outputDirectory = await (dependencies.resolveOutputDirectory ?? resolveSimpleWritingOutputDirectory)({
        writingDate: options.writingDate,
        dryRun: options.dryRun ?? false,
        ...(options.outputRoot === undefined ? {} : { outputRoot: options.outputRoot }),
      });
      const files = await (dependencies.writeSuccessFiles ?? writeSimpleWritingSuccessFiles)({
        repositoryRoot: options.rootDir,
        outputDirectory,
        input,
        pack,
      });
      return { pack, files_written: true, output_directory: path.dirname(files.article), files };
    } catch {
      return noModelResult({
        ...pack,
        status: 'failed',
        decision: null,
        error_code: 'storage_failed',
        error_message_safe: 'Simple Writing output could not be saved to the private review directory.',
      });
    }
  } catch (error) {
    const durationMs = Math.max(0, Math.round(performance.now() - attemptedAt));
    return noModelResult({
      ...base,
      status: 'failed',
      decision: null,
      output: null,
      checks: null,
      model: {
        provider: providerName,
        model: modelName,
        runtime_version: runtimeVersion,
        calls: 1,
        duration_ms: durationMs,
        usage: null,
      },
      error_code: providerFailureCode(error),
      error_message_safe: 'Writer failed. The model was not retried.',
    });
  }
}
