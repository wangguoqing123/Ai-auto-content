import { z } from 'zod';
import { chooseApprovedCandidate, evaluateCandidate, inferNoPublishReason } from './candidate-evaluator.js';
import { loadTopicIntelligenceConfig } from './config.js';
import { loadTopicHistory, type TopicHistoryEntry } from './history.js';
import { computeTopicInputHash } from './input-hash.js';
import { buildTopicMaterialInput, refreshSelectedSummary } from './material-input.js';
import { loadTopicProductTruth } from './product-context.js';
import { buildTopicJudgeData } from './prompt.js';
import { buildFixtureMaterialInput, FixtureTopicJudgeProvider, type FixtureTopicJudgeMode } from './providers/fixture-topic-judge-provider.js';
import { OpenAITopicJudgeProvider } from './providers/openai-topic-judge-provider.js';
import {
  TopicJudgeTimeoutError,
  TopicJudgeUnavailableError,
  type TopicJudgeProvider,
  type TopicJudgeUsage,
} from './providers/topic-judge-provider.js';
import {
  topicDecisionSchema,
  topicJudgeProviderResultSchema,
  type TopicDecision,
  type TopicInputSummary,
  type TopicJudgeProviderResult,
  type TopicMaterialCard,
} from './schemas.js';
import { readExistingTopicDecision, writeTopicOutputs } from './storage.js';

export interface RunTopicSelectionOptions {
  rootDir?: string;
  decisionDate: string;
  dryRun?: boolean;
  fixture?: boolean;
  fixtureMode?: FixtureTopicJudgeMode;
  provider?: TopicJudgeProvider;
}

export interface RunTopicSelectionResult {
  execution_status: 'DECIDED' | 'ALREADY_DECIDED';
  decision: TopicDecision;
  files_written: boolean;
}

function runId(now = new Date()): string {
  return `topic_${now.toISOString().replace(/[:.]/g, '-')}`;
}

function emptySummary(): TopicInputSummary {
  return {
    total_before_filter: 0,
    eligible_total: 0,
    total_after_filter: 0,
    cloud_count: 0,
    twitter_count: 0,
    weixin_resolved_count: 0,
    restricted_count: 0,
    fact_source_count: 0,
    trend_signal_count: 0,
    structure_inspiration_count: 0,
    eligible_by_bucket: { cloud: 0, twitter: 0, weixin_resolved: 0, weixin_restricted: 0 },
    selected_by_bucket: { cloud: 0, twitter: 0, weixin_resolved: 0, weixin_restricted: 0 },
    dropped_by_reason: {
      duplicate: 0, outside_window: 0, invalid_status: 0, invalid_url: 0, invalid_material: 0,
      sensitive_content: 0, author_limit: 0, query_limit: 0, cluster_limit: 0, bucket_limit: 0, character_limit: 0,
    },
    source_gaps: ['browser_missing', 'cloud_missing'],
  };
}

function providerFromEnvironment(fixture: boolean, mode: FixtureTopicJudgeMode): TopicJudgeProvider {
  if (fixture) return new FixtureTopicJudgeProvider(mode);
  if (process.env.TOPIC_LLM_PROVIDER !== 'openai') {
    throw new Error('TOPIC_LLM_PROVIDER must be explicitly set to openai');
  }
  return new OpenAITopicJudgeProvider({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.TOPIC_LLM_MODEL ?? '',
    ...(process.env.TOPIC_LLM_BASE_URL === undefined ? {} : { baseURL: process.env.TOPIC_LLM_BASE_URL }),
  });
}

function declaredProvider(options: RunTopicSelectionOptions, fixture: boolean): { provider: string; model: string } {
  if (options.provider !== undefined) return { provider: options.provider.providerName, model: options.provider.modelName };
  if (fixture) return { provider: 'fixture', model: 'offline-fixture' };
  return { provider: process.env.TOPIC_LLM_PROVIDER ?? 'unconfigured', model: process.env.TOPIC_LLM_MODEL ?? '' };
}

function failedDecision(input: {
  decisionDate: string;
  promptVersion: string;
  inputHash: string;
  summary: TopicInputSummary;
  provider: string;
  model: string;
  calls: number;
  durationMs: number;
  usage: TopicJudgeUsage | null;
  errorCode: TopicDecision['error_code'];
  safeMessage: string;
}): TopicDecision {
  return topicDecisionSchema.parse({
    version: 1,
    decision_date: input.decisionDate,
    run_id: runId(),
    status: 'failed',
    decision: null,
    prompt_version: input.promptVersion,
    input_hash: input.inputHash,
    input_summary: input.summary,
    selected_topic: null,
    evaluated_candidates: [],
    no_publish_reason_code: null,
    no_publish_reason: null,
    model: {
      provider: input.provider,
      model: input.model,
      calls: input.calls,
      duration_ms: input.durationMs,
      usage: input.usage,
    },
    error_code: input.errorCode,
    error_message_safe: input.safeMessage,
    created_at: new Date().toISOString(),
  });
}

function mergeUsage(left: TopicJudgeUsage | null, right: TopicJudgeUsage | null): TopicJudgeUsage | null {
  if (left === null) return right;
  if (right === null) return left;
  const sum = (a: number | null, b: number | null) => a === null && b === null ? null : (a ?? 0) + (b ?? 0);
  return {
    input_tokens: sum(left.input_tokens, right.input_tokens),
    output_tokens: sum(left.output_tokens, right.output_tokens),
    total_tokens: sum(left.total_tokens, right.total_tokens),
  };
}

async function finalize(
  rootDir: string,
  decision: TopicDecision,
  materials: Map<string, TopicMaterialCard>,
  shouldWrite: boolean,
): Promise<RunTopicSelectionResult> {
  if (!shouldWrite) return { execution_status: 'DECIDED', decision, files_written: false };
  try {
    await writeTopicOutputs(rootDir, decision, materials);
    return { execution_status: 'DECIDED', decision, files_written: true };
  } catch {
    return {
      execution_status: 'DECIDED',
      decision: failedDecision({
        decisionDate: decision.decision_date,
        promptVersion: decision.prompt_version,
        inputHash: decision.input_hash,
        summary: decision.input_summary,
        provider: decision.model.provider,
        model: decision.model.model,
        calls: decision.model.calls,
        durationMs: decision.model.duration_ms,
        usage: decision.model.usage,
        errorCode: 'file_read_failed',
        safeMessage: 'Topic output files could not be written safely.',
      }),
      files_written: false,
    };
  }
}

function inputFailureCode(error: unknown): 'schema_invalid' | 'file_read_failed' {
  return error instanceof SyntaxError || error instanceof z.ZodError ? 'schema_invalid' : 'file_read_failed';
}

export async function runTopicSelection(options: RunTopicSelectionOptions): Promise<RunTopicSelectionResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const fixture = options.fixture ?? false;
  const shouldWrite = !(options.dryRun ?? false) && !fixture;
  const declared = declaredProvider(options, fixture);
  let config;
  try {
    config = await loadTopicIntelligenceConfig(rootDir);
  } catch {
    return {
      execution_status: 'DECIDED',
      decision: failedDecision({
        decisionDate: options.decisionDate,
        promptVersion: 'topic-intelligence-v1',
        inputHash: '0'.repeat(64),
        summary: emptySummary(),
        provider: declared.provider,
        model: declared.model,
        calls: 0,
        durationMs: 0,
        usage: null,
        errorCode: 'configuration_invalid',
        safeMessage: 'Topic intelligence configuration is invalid.',
      }),
      files_written: false,
    };
  }

  let productTruth;
  let materialInput;
  let history: TopicHistoryEntry[];
  let exactHistory: TopicHistoryEntry[];
  let similarityHistory: TopicHistoryEntry[];
  try {
    [productTruth, materialInput, history, exactHistory, similarityHistory] = await Promise.all([
      loadTopicProductTruth(rootDir),
      fixture ? Promise.resolve(buildFixtureMaterialInput()) : buildTopicMaterialInput(rootDir, options.decisionDate, config),
      loadTopicHistory(rootDir, options.decisionDate, config.input.history_window_days),
      loadTopicHistory(rootDir, options.decisionDate, config.history.exact_signature_window_days),
      loadTopicHistory(rootDir, options.decisionDate, config.history.similarity_window_days),
    ]);
  } catch (error) {
    return {
      execution_status: 'DECIDED',
      decision: failedDecision({
        decisionDate: options.decisionDate,
        promptVersion: config.model.prompt_version,
        inputHash: '0'.repeat(64),
        summary: emptySummary(),
        provider: declared.provider,
        model: declared.model,
        calls: 0,
        durationMs: 0,
        usage: null,
        errorCode: inputFailureCode(error),
        safeMessage: 'Topic input files could not be read safely.',
      }),
      files_written: false,
    };
  }

  const hadUsableMaterials = materialInput.cards.length > 0;
  const baseJudgeInput = {
    decisionDate: options.decisionDate,
    materials: materialInput.cards,
    productContext: productTruth.context,
    recentTopics: history,
    config: { candidates: config.candidates, output: config.output },
  };
  while (baseJudgeInput.materials.length > 0
    && buildTopicJudgeData(baseJudgeInput).length > config.input.max_model_input_chars) {
    baseJudgeInput.materials.pop();
    materialInput.summary.dropped_by_reason.character_limit += 1;
  }
  materialInput.cards = baseJudgeInput.materials;
  materialInput.materialById = new Map(materialInput.cards.map((card) => [card.material_id, card]));
  refreshSelectedSummary(materialInput.summary, materialInput.cards);
  const inputBudgetExceeded = hadUsableMaterials
    && materialInput.cards.length === 0
    && buildTopicJudgeData(baseJudgeInput).length > config.input.max_model_input_chars;
  const hashProvider = materialInput.cards.length === 0 ? 'not_invoked' : declared.provider;
  const hashModel = materialInput.cards.length === 0 ? '' : declared.model;
  let inputHash: string;
  try {
    inputHash = await computeTopicInputHash({
      rootDir,
      materials: materialInput.cards,
      history,
      provider: hashProvider,
      model: hashModel,
      promptVersion: config.model.prompt_version,
    });
  } catch {
    return {
      execution_status: 'DECIDED',
      decision: failedDecision({
        decisionDate: options.decisionDate,
        promptVersion: config.model.prompt_version,
        inputHash: '0'.repeat(64),
        summary: materialInput.summary,
        provider: hashProvider,
        model: hashModel,
        calls: 0,
        durationMs: 0,
        usage: null,
        errorCode: 'file_read_failed',
        safeMessage: 'Topic input hash could not be computed safely.',
      }),
      files_written: false,
    };
  }

  if (shouldWrite) {
    const existing = await readExistingTopicDecision(rootDir, options.decisionDate);
    if (existing.state === 'invalid') {
      return {
        execution_status: 'DECIDED',
        decision: failedDecision({
          decisionDate: options.decisionDate,
          promptVersion: config.model.prompt_version,
          inputHash,
          summary: materialInput.summary,
          provider: hashProvider,
          model: hashModel,
          calls: 0,
          durationMs: 0,
          usage: null,
          errorCode: existing.errorCode,
          safeMessage: existing.safeMessage,
        }),
        files_written: false,
      };
    }
    if (existing.state === 'valid' && existing.decision.status === 'success' && existing.decision.input_hash === inputHash) {
      return { execution_status: 'ALREADY_DECIDED', decision: existing.decision, files_written: false };
    }
  }

  if (inputBudgetExceeded) {
    return finalize(rootDir, failedDecision({
      decisionDate: options.decisionDate,
      promptVersion: config.model.prompt_version,
      inputHash,
      summary: materialInput.summary,
      provider: hashProvider,
      model: hashModel,
      calls: 0,
      durationMs: 0,
      usage: null,
      errorCode: 'configuration_invalid',
      safeMessage: 'The configured model input limit is too small for the required product context.',
    }), materialInput.materialById, shouldWrite);
  }

  if (materialInput.cards.length === 0) {
    const decision = topicDecisionSchema.parse({
      version: 1,
      decision_date: options.decisionDate,
      run_id: runId(),
      status: 'success',
      decision: 'NO_PUBLISH',
      prompt_version: config.model.prompt_version,
      input_hash: inputHash,
      input_summary: materialInput.summary,
      selected_topic: null,
      evaluated_candidates: [],
      no_publish_reason_code: 'no_usable_materials',
      no_publish_reason: '最近 72 小时没有可用材料，未调用模型。',
      model: { provider: 'not_invoked', model: '', calls: 0, duration_ms: 0, usage: null },
      error_code: null,
      error_message_safe: null,
      created_at: new Date().toISOString(),
    });
    return finalize(rootDir, decision, materialInput.materialById, shouldWrite);
  }

  let provider: TopicJudgeProvider;
  try {
    provider = options.provider ?? providerFromEnvironment(fixture, options.fixtureMode ?? 'select');
  } catch (error) {
    const unavailable = error instanceof TopicJudgeUnavailableError;
    return finalize(rootDir, failedDecision({
      decisionDate: options.decisionDate,
      promptVersion: config.model.prompt_version,
      inputHash,
      summary: materialInput.summary,
      provider: declared.provider,
      model: declared.model,
      calls: 0,
      durationMs: 0,
      usage: null,
      errorCode: unavailable ? 'model_unavailable' : 'configuration_invalid',
      safeMessage: unavailable ? 'Topic judge provider is unavailable.' : 'Topic model provider configuration is invalid.',
    }), materialInput.materialById, shouldWrite);
  }

  const judgeInput = baseJudgeInput;
  let calls = 0;
  let durationMs = 0;
  let usage: TopicJudgeUsage | null = null;
  let providerOutput: TopicJudgeProviderResult;
  const judgingStarted = Date.now();
  try {
    calls += 1;
    const first = await provider.judge(judgeInput);
    durationMs += first.durationMs;
    usage = mergeUsage(usage, first.usage);
    let parsed = topicJudgeProviderResultSchema.safeParse(first.output);
    if (!parsed.success && config.model.repair_attempts === 1 && calls < config.model.maximum_calls_per_run) {
      const errors = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      calls += 1;
      const repaired = await provider.repair(judgeInput, errors);
      durationMs += repaired.durationMs;
      usage = mergeUsage(usage, repaired.usage);
      parsed = topicJudgeProviderResultSchema.safeParse(repaired.output);
    }
    if (!parsed.success) {
      return finalize(rootDir, failedDecision({
        decisionDate: options.decisionDate,
        promptVersion: config.model.prompt_version,
        inputHash,
        summary: materialInput.summary,
        provider: provider.providerName,
        model: provider.modelName,
        calls,
        durationMs,
        usage,
        errorCode: 'model_output_invalid',
        safeMessage: 'Topic judge output did not match the strict schema after the allowed repair attempt.',
      }), materialInput.materialById, shouldWrite);
    }
    providerOutput = parsed.data;
  } catch (error) {
    durationMs = Math.max(durationMs, Date.now() - judgingStarted);
    const timeout = error instanceof TopicJudgeTimeoutError;
    return finalize(rootDir, failedDecision({
      decisionDate: options.decisionDate,
      promptVersion: config.model.prompt_version,
      inputHash,
      summary: materialInput.summary,
      provider: provider.providerName,
      model: provider.modelName,
      calls,
      durationMs,
      usage,
      errorCode: timeout ? 'model_timeout' : 'model_unavailable',
      safeMessage: timeout ? 'Topic judge provider timed out.' : 'Topic judge provider is unavailable.',
    }), materialInput.materialById, shouldWrite);
  }

  try {
    const evaluated = [];
    for (const candidate of providerOutput.candidates.slice(0, config.candidates.maximum)) {
      evaluated.push(await evaluateCandidate(candidate, {
        rootDir,
        config,
        product: productTruth.product,
        contentFit: productTruth.contentFit,
        materials: materialInput.materialById,
        history,
        exactHistory,
        similarityHistory,
        contentMix: productTruth.context.contentMix,
      }));
    }
    const selected = chooseApprovedCandidate(evaluated, config, history, productTruth.context.contentMix);
    const fallback = inferNoPublishReason(evaluated);
    const useProviderNoPublishReason = selected === null && evaluated.length === 0;
    const noPublishCode = selected === null
      ? useProviderNoPublishReason ? providerOutput.no_publish_reason_code ?? fallback.code : fallback.code
      : null;
    const noPublishReason = selected === null
      ? useProviderNoPublishReason ? providerOutput.no_publish_reason ?? fallback.reason : fallback.reason
      : null;
    const decision = topicDecisionSchema.parse({
      version: 1,
      decision_date: options.decisionDate,
      run_id: runId(),
      status: 'success',
      decision: selected === null ? 'NO_PUBLISH' : 'SELECT_TOPIC',
      prompt_version: config.model.prompt_version,
      input_hash: inputHash,
      input_summary: materialInput.summary,
      selected_topic: selected,
      evaluated_candidates: evaluated,
      no_publish_reason_code: noPublishCode,
      no_publish_reason: noPublishReason,
      model: { provider: provider.providerName, model: provider.modelName, calls, duration_ms: durationMs, usage },
      error_code: null,
      error_message_safe: null,
      created_at: new Date().toISOString(),
    });
    return finalize(rootDir, decision, materialInput.materialById, shouldWrite);
  } catch {
    return finalize(rootDir, failedDecision({
      decisionDate: options.decisionDate,
      promptVersion: config.model.prompt_version,
      inputHash,
      summary: materialInput.summary,
      provider: provider.providerName,
      model: provider.modelName,
      calls,
      durationMs,
      usage,
      errorCode: 'schema_invalid',
      safeMessage: 'Topic candidate evaluation failed strict validation.',
    }), materialInput.materialById, shouldWrite);
  }
}
