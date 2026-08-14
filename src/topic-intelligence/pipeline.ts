import { chooseApprovedCandidate, evaluateCandidate, inferNoPublishReason } from './candidate-evaluator.js';
import { loadTopicIntelligenceConfig } from './config.js';
import { loadTopicHistory } from './history.js';
import { computeTopicInputHash } from './input-hash.js';
import { buildTopicMaterialInput } from './material-input.js';
import { loadTopicProductTruth } from './product-context.js';
import { buildTopicJudgeData } from './prompt.js';
import { buildFixtureMaterialInput, FixtureTopicJudgeProvider, type FixtureTopicJudgeMode } from './providers/fixture-topic-judge-provider.js';
import { OpenAITopicJudgeProvider } from './providers/openai-topic-judge-provider.js';
import {
  TopicJudgeUnavailableError,
  type TopicJudgeProvider,
  type TopicJudgeUsage,
} from './providers/topic-judge-provider.js';
import {
  topicDecisionSchema,
  topicJudgeProviderResultSchema,
  type TopicDecision,
  type TopicInputSummary,
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
    total_after_filter: 0,
    cloud_count: 0,
    twitter_count: 0,
    weixin_resolved_count: 0,
    restricted_count: 0,
    fact_source_count: 0,
    trend_signal_count: 0,
    structure_inspiration_count: 0,
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

async function maybeWrite(
  rootDir: string,
  decision: TopicDecision,
  materialById: Parameters<typeof writeTopicOutputs>[2],
  shouldWrite: boolean,
): Promise<boolean> {
  if (!shouldWrite) return false;
  await writeTopicOutputs(rootDir, decision, materialById);
  return true;
}

export async function runTopicSelection(options: RunTopicSelectionOptions): Promise<RunTopicSelectionResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const fixture = options.fixture ?? false;
  const shouldWrite = !(options.dryRun ?? false) && !fixture;
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
        provider: fixture ? 'fixture' : process.env.TOPIC_LLM_PROVIDER ?? 'unconfigured',
        model: fixture ? 'offline-fixture' : process.env.TOPIC_LLM_MODEL ?? '',
        calls: 0,
        durationMs: 0,
        usage: null,
        errorCode: 'configuration_invalid',
        safeMessage: 'Topic intelligence configuration is invalid.',
      }),
      files_written: false,
    };
  }

  let provider: TopicJudgeProvider;
  try {
    provider = options.provider ?? providerFromEnvironment(fixture, options.fixtureMode ?? 'select');
  } catch (error) {
    const unavailable = error instanceof TopicJudgeUnavailableError;
    return {
      execution_status: 'DECIDED',
      decision: failedDecision({
        decisionDate: options.decisionDate,
        promptVersion: config.model.prompt_version,
        inputHash: '0'.repeat(64),
        summary: emptySummary(),
        provider: fixture ? 'fixture' : process.env.TOPIC_LLM_PROVIDER ?? 'unconfigured',
        model: fixture ? 'offline-fixture' : process.env.TOPIC_LLM_MODEL ?? '',
        calls: 0,
        durationMs: 0,
        usage: null,
        errorCode: unavailable ? 'model_unavailable' : 'configuration_invalid',
        safeMessage: unavailable ? 'Topic judge provider is unavailable.' : 'Topic model provider configuration is invalid.',
      }),
      files_written: false,
    };
  }

  let productTruth;
  let materialInput;
  let history;
  try {
    [productTruth, materialInput, history] = await Promise.all([
      loadTopicProductTruth(rootDir),
      fixture ? Promise.resolve(buildFixtureMaterialInput()) : buildTopicMaterialInput(rootDir, options.decisionDate, config),
      loadTopicHistory(rootDir, options.decisionDate, config.input.history_window_days),
    ]);
  } catch {
    const decision = failedDecision({
      decisionDate: options.decisionDate,
      promptVersion: config.model.prompt_version,
      inputHash: '0'.repeat(64),
      summary: emptySummary(),
      provider: provider.providerName,
      model: provider.modelName,
      calls: 0,
      durationMs: 0,
      usage: null,
      errorCode: 'file_read_failed',
      safeMessage: 'Topic input files could not be read safely.',
    });
    return { execution_status: 'DECIDED', decision, files_written: false };
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
  }
  materialInput.cards = baseJudgeInput.materials;
  materialInput.materialById = new Map(materialInput.cards.map((card) => [card.material_id, card]));
  materialInput.summary.total_after_filter = materialInput.cards.length;
  materialInput.summary.cloud_count = materialInput.cards.filter(({ source_platform }) => source_platform === 'rss' || source_platform === 'aihot').length;
  materialInput.summary.twitter_count = materialInput.cards.filter(({ source_platform }) => source_platform === 'twitter').length;
  materialInput.summary.weixin_resolved_count = materialInput.cards.filter(({ source_platform, role }) => source_platform === 'weixin' && role !== 'restricted_inspiration_only').length;
  materialInput.summary.restricted_count = materialInput.cards.filter(({ role }) => role === 'restricted_inspiration_only').length;
  materialInput.summary.fact_source_count = materialInput.cards.filter(({ role }) => role === 'fact_source').length;
  materialInput.summary.trend_signal_count = materialInput.cards.filter(({ role }) => role === 'trend_signal').length;
  materialInput.summary.structure_inspiration_count = materialInput.cards.filter(({ role }) => role === 'structure_inspiration').length;
  const inputBudgetExceeded = hadUsableMaterials
    && materialInput.cards.length === 0
    && buildTopicJudgeData(baseJudgeInput).length > config.input.max_model_input_chars;

  const inputHash = await computeTopicInputHash({
    rootDir,
    materials: materialInput.cards,
    history,
    provider: provider.providerName,
    model: provider.modelName,
    promptVersion: config.model.prompt_version,
  });
  if (inputBudgetExceeded) {
    const decision = failedDecision({
      decisionDate: options.decisionDate,
      promptVersion: config.model.prompt_version,
      inputHash,
      summary: materialInput.summary,
      provider: provider.providerName,
      model: provider.modelName,
      calls: 0,
      durationMs: 0,
      usage: null,
      errorCode: 'configuration_invalid',
      safeMessage: 'The configured model input limit is too small for the required product context.',
    });
    const filesWritten = await maybeWrite(rootDir, decision, materialInput.materialById, shouldWrite);
    return { execution_status: 'DECIDED', decision, files_written: filesWritten };
  }
  if (shouldWrite) {
    const existing = await readExistingTopicDecision(rootDir, options.decisionDate);
    if (existing?.status === 'success' && existing.input_hash === inputHash) {
      return { execution_status: 'ALREADY_DECIDED', decision: existing, files_written: false };
    }
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
      model: { provider: provider.providerName, model: provider.modelName, calls: 0, duration_ms: 0, usage: null },
      error_code: null,
      error_message_safe: null,
      created_at: new Date().toISOString(),
    });
    const filesWritten = await maybeWrite(rootDir, decision, materialInput.materialById, shouldWrite);
    return { execution_status: 'DECIDED', decision, files_written: filesWritten };
  }

  const judgeInput = baseJudgeInput;
  let calls = 0;
  let durationMs = 0;
  let usage: TopicJudgeUsage | null = null;
  let providerOutput;
  try {
    const first = await provider.judge(judgeInput);
    calls += 1;
    durationMs += first.durationMs;
    usage = mergeUsage(usage, first.usage);
    let parsed = topicJudgeProviderResultSchema.safeParse(first.output);
    if (!parsed.success && config.model.repair_attempts === 1 && calls < config.model.maximum_calls_per_run) {
      const errors = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      const repaired = await provider.repair(judgeInput, errors);
      calls += 1;
      durationMs += repaired.durationMs;
      usage = mergeUsage(usage, repaired.usage);
      parsed = topicJudgeProviderResultSchema.safeParse(repaired.output);
    }
    if (!parsed.success) {
      const decision = failedDecision({
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
      });
      const filesWritten = await maybeWrite(rootDir, decision, materialInput.materialById, shouldWrite);
      return { execution_status: 'DECIDED', decision, files_written: filesWritten };
    }
    providerOutput = parsed.data;
  } catch (error) {
    const decision = failedDecision({
      decisionDate: options.decisionDate,
      promptVersion: config.model.prompt_version,
      inputHash,
      summary: materialInput.summary,
      provider: provider.providerName,
      model: provider.modelName,
      calls: Math.max(1, calls),
      durationMs,
      usage,
      errorCode: error instanceof TopicJudgeUnavailableError ? 'model_unavailable' : 'model_unavailable',
      safeMessage: 'Topic judge provider is unavailable.',
    });
    const filesWritten = await maybeWrite(rootDir, decision, materialInput.materialById, shouldWrite);
    return { execution_status: 'DECIDED', decision, files_written: filesWritten };
  }

  const evaluated = [];
  for (const candidate of providerOutput.candidates.slice(0, config.candidates.maximum)) {
    evaluated.push(await evaluateCandidate(candidate, {
      rootDir,
      config,
      product: productTruth.product,
      contentFit: productTruth.contentFit,
      materials: materialInput.materialById,
      history,
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
  const filesWritten = await maybeWrite(rootDir, decision, materialInput.materialById, shouldWrite);
  return { execution_status: 'DECIDED', decision, files_written: filesWritten };
}
