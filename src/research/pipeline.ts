import { writeResearchCacheSnapshot, defaultResearchCacheRoot } from './cache.js';
import { verifyResearchProviderResult } from './claim-verification.js';
import { loadExperimentTaskCatalog, loadResearchIntelligenceConfig } from './config.js';
import { runExperimentBundle } from './experiment.js';
import { buildFixtureResearchSources } from './fixture.js';
import { computeResearchInputHash, fallbackResearchInputHash } from './input-hash.js';
import { codexCliResearchProviderFromEnvironment } from './providers/codex-cli-research-provider.js';
import { FixtureResearchProvider } from './providers/fixture-research-provider.js';
import {
  ResearchProviderTimeoutError,
  ResearchProviderUnavailableError,
  type ResearchProvider,
  type ResearchProviderCall,
} from './providers/research-provider.js';
import { fetchAndExtractMaterial } from './source-fetcher.js';
import { loadFactSourceMaterials, ResearchSourceMaterialError } from './source-materials.js';
import { readExistingResearchPack, writeResearchOutputs } from './storage.js';
import {
  researchPackSchema,
  type CleanedSourceSnapshot,
  type ExperimentBundle,
  type ResearchPack,
  type ResearchProviderResult,
  type ResearchSourceManifest,
} from './schemas.js';
import { loadTopicProductTruth } from '../topic-intelligence/product-context.js';
import { readExistingTopicDecision } from '../topic-intelligence/storage.js';
import type { TopicDecision, TopicCandidate } from '../topic-intelligence/schemas.js';
import type { UnifiedMaterial } from '../types.js';

export interface RunResearchBuildOptions {
  rootDir?: string;
  researchDate: string;
  dryRun?: boolean;
  fixture?: boolean;
  provider?: ResearchProvider;
  cacheRoot?: string;
  fetchSource?: typeof fetchAndExtractMaterial;
}

export interface RunResearchBuildResult {
  execution_status: 'RESEARCHED' | 'ALREADY_RESEARCHED';
  pack: ResearchPack;
  files_written: boolean;
}

function runId(now = new Date()): string {
  return `research_${now.toISOString().replace(/[:.]/g, '-')}`;
}

function emptyWritingRequirements() {
  return {
    main_promise: 'Research did not start because the required input was unavailable.',
    minimum_result: 'Resolve the reported infrastructure error before writing.',
    required_claim_ids: [],
    required_disclosures: [],
    forbidden_claims: ['Do not write from a failed Research Pack.'],
    required_visual_evidence: [],
  };
}

function topicSnapshot(topic: TopicCandidate, decision: TopicDecision) {
  return {
    topic_signature: topic.topic_signature,
    topic_run_id: decision.run_id,
    working_title: topic.working_title,
    learner_stage: topic.learner_stage,
    content_pillar: topic.content_pillar,
    primary_product_module_id: topic.primary_product_module_id,
    cta_mode: topic.cta_mode,
  };
}

function usageAdd(
  left: ResearchProviderCall<unknown>['usage'],
  right: ResearchProviderCall<unknown>['usage'],
) {
  if (left === null) return right;
  if (right === null) return left;
  const add = (a: number | null, b: number | null) => a === null && b === null ? null : (a ?? 0) + (b ?? 0);
  return {
    input_tokens: add(left.input_tokens, right.input_tokens),
    output_tokens: add(left.output_tokens, right.output_tokens),
    total_tokens: add(left.total_tokens, right.total_tokens),
  };
}

function failedPack(input: {
  researchDate: string;
  inputHash: string;
  errorCode: ResearchPack['error_code'];
  message: string;
  provider: string;
  model: string;
  runtimeVersion?: string | null;
  topic?: ResearchPack['topic'];
  calls?: number;
  durationMs?: number;
  usage?: ResearchProviderCall<unknown>['usage'];
  sources?: ResearchSourceManifest[];
  requestedSources?: number;
  failedSources?: number;
  unsupportedContentTypes?: number;
}): ResearchPack {
  const sources = input.sources ?? [];
  return researchPackSchema.parse({
    version: 1,
    research_date: input.researchDate,
    run_id: runId(),
    status: 'failed',
    decision: null,
    topic: input.topic ?? null,
    input_hash: input.inputHash,
    source_summary: {
      requested: input.requestedSources ?? sources.length,
      fetched: sources.filter(({ fetch_status }) => fetch_status === 'success').length,
      failed: input.failedSources ?? sources.filter(({ fetch_status }) => fetch_status === 'failed').length,
      unsupported_content_type: input.unsupportedContentTypes
        ?? sources.filter(({ fetch_status }) => fetch_status === 'unsupported_content_type').length,
    },
    sources,
    verified_claims: [],
    research_answers: [],
    experiment: null,
    writing_requirements: emptyWritingRequirements(),
    readiness: { fact_claims_verified: false, research_questions_sufficient: false, experiment_completed: false, open_gaps: [input.message] },
    model: {
      provider: input.provider,
      model: input.model,
      runtime_version: input.runtimeVersion ?? null,
      calls: input.calls ?? 0,
      duration_ms: input.durationMs ?? 0,
      usage: input.usage ?? null,
    },
    error_code: input.errorCode,
    error_message_safe: input.message.slice(0, 1_000),
    created_at: new Date().toISOString(),
  });
}

function noTopicPack(input: {
  researchDate: string;
  decision: TopicDecision;
  inputHash: string;
  provider: string;
  model: string;
}): ResearchPack {
  return researchPackSchema.parse({
    version: 1,
    research_date: input.researchDate,
    run_id: runId(),
    status: 'success',
    decision: 'NO_TOPIC',
    topic: null,
    input_hash: input.inputHash,
    source_summary: { requested: 0, fetched: 0, failed: 0, unsupported_content_type: 0 },
    sources: [], verified_claims: [], research_answers: [], experiment: null,
    writing_requirements: {
      main_promise: 'No topic was selected for this date.',
      minimum_result: 'Do not enter the writing stage.',
      required_claim_ids: [], required_disclosures: [],
      forbidden_claims: ['Do not create content when the Topic Decision is NO_PUBLISH.'],
      required_visual_evidence: [],
    },
    readiness: { fact_claims_verified: true, research_questions_sufficient: true, experiment_completed: true, open_gaps: [] },
    model: { provider: input.provider, model: input.model, runtime_version: null, calls: 0, duration_ms: 0, usage: null },
    error_code: null, error_message_safe: null, created_at: new Date().toISOString(),
  });
}

function manifests(
  materials: UnifiedMaterial[],
  sources: CleanedSourceSnapshot[],
  result: ResearchProviderResult | null,
): ResearchSourceManifest[] {
  return sources.map((source) => {
    const material = materials.find(({ material_id }) => material_id === source.material_id)!;
    return {
      source_id: source.source_id,
      material_id: source.material_id,
      canonical_url: material.canonical_url,
      final_url: source.final_url,
      title: source.title,
      author: source.author,
      retrieved_at: source.retrieved_at,
      content_type: source.content_type,
      content_sha256: source.content_sha256,
      fetch_status: 'success',
      selected_quotes: (result?.verified_claims ?? [])
        .filter((claim) => claim.source_id === source.source_id && claim.support_status !== 'unsupported')
        .map((claim) => ({ claim_id: claim.claim_id, segment_id: claim.segment_id!, quote: claim.quote })),
      error_code: null,
    };
  });
}

function finalizedRequirements(topic: TopicCandidate, result: ResearchProviderResult, experiment: ExperimentBundle | null) {
  return {
    main_promise: topic.one_sentence_promise,
    minimum_result: topic.minimum_result,
    required_claim_ids: result.writing_requirements.required_claim_ids,
    required_disclosures: [...new Set([
      ...topic.risk_flags,
      ...result.writing_requirements.required_disclosures,
      ...(experiment?.limitations ?? []),
    ])],
    forbidden_claims: [...new Set([
      ...result.writing_requirements.forbidden_claims,
      'Do not claim a universal efficiency percentage or best workflow.',
      'Do not invent first-person or long-term testing.',
      'Do not add unconfirmed product rights.',
    ])],
    required_visual_evidence: [...new Set([
      ...topic.platform_plan.wechat_required_evidence,
      ...result.writing_requirements.required_visual_evidence,
    ])],
  };
}

function providerDeclaration(options: RunResearchBuildOptions, fixture: boolean) {
  if (options.provider !== undefined) return {
    provider: options.provider.providerName, model: options.provider.modelName, runtimeVersion: options.provider.runtimeVersion,
  };
  if (fixture) return { provider: 'fixture', model: 'offline-fixture', runtimeVersion: 'fixture-v1' };
  return {
    provider: 'codex_cli',
    model: process.env.RESEARCH_CODEX_MODEL ?? process.env.TOPIC_CODEX_MODEL ?? '',
    runtimeVersion: null,
  };
}

async function finish(rootDir: string, pack: ResearchPack, shouldWrite: boolean): Promise<RunResearchBuildResult> {
  if (shouldWrite) await writeResearchOutputs(rootDir, pack);
  return { execution_status: 'RESEARCHED', pack, files_written: shouldWrite };
}

function errorCode(error: unknown): NonNullable<ResearchPack['error_code']> {
  if (error instanceof ResearchProviderTimeoutError) return 'codex_timeout';
  if (error instanceof ResearchProviderUnavailableError) {
    const allowed: Array<NonNullable<ResearchPack['error_code']>> = [
      'codex_not_installed', 'codex_not_authenticated', 'codex_timeout', 'codex_rate_limited',
      'codex_output_invalid', 'codex_process_failed', 'codex_sandbox_unavailable',
    ];
    return allowed.includes(error.code as never) ? error.code as NonNullable<ResearchPack['error_code']> : 'codex_process_failed';
  }
  if (error instanceof ResearchSourceMaterialError) return 'source_material_invalid';
  return 'source_fetch_failed';
}

export async function runResearchBuild(options: RunResearchBuildOptions): Promise<RunResearchBuildResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const fixture = options.fixture ?? false;
  const declared = providerDeclaration(options, fixture);
  let config;
  let catalog;
  try {
    [config, catalog] = await Promise.all([
      loadResearchIntelligenceConfig(rootDir), loadExperimentTaskCatalog(rootDir),
    ]);
  } catch (error) {
    return finish(rootDir, failedPack({
      researchDate: options.researchDate,
      inputHash: fallbackResearchInputHash({ date: options.researchDate, error: 'configuration_invalid' }),
      errorCode: 'configuration_invalid', message: error instanceof Error ? error.message : String(error),
      provider: declared.provider, model: declared.model,
    }), !dryRun);
  }
  const topicInput = await readExistingTopicDecision(rootDir, options.researchDate);
  if (topicInput.state !== 'valid' || topicInput.decision.status === 'failed') {
    const code = topicInput.state === 'absent' ? 'topic_input_missing' : 'topic_input_invalid';
    return finish(rootDir, failedPack({
      researchDate: options.researchDate,
      inputHash: fallbackResearchInputHash({ date: options.researchDate, error: code }),
      errorCode: code,
      message: topicInput.state === 'invalid' ? topicInput.safeMessage : code === 'topic_input_missing' ? 'Topic Decision is missing.' : 'Topic Decision has status=failed.',
      provider: declared.provider, model: declared.model,
    }), !dryRun);
  }
  const decision = topicInput.decision;
  if (decision.decision === 'NO_PUBLISH') {
    const pack = noTopicPack({
      researchDate: options.researchDate, decision,
      inputHash: fallbackResearchInputHash({ topic_input_hash: decision.input_hash, decision: 'NO_PUBLISH', config: config.research.prompt_version }),
      provider: declared.provider, model: declared.model,
    });
    return finish(rootDir, pack, !dryRun);
  }
  const topic = decision.selected_topic!;
  let materials: UnifiedMaterial[];
  try {
    materials = await loadFactSourceMaterials(rootDir, decision, config.source_fetch.maximum_sources);
  } catch (error) {
    return finish(rootDir, failedPack({
      researchDate: options.researchDate,
      inputHash: fallbackResearchInputHash({ topic_input_hash: decision.input_hash, error: 'source_material_invalid' }),
      errorCode: 'source_material_invalid', message: error instanceof Error ? error.message : String(error),
      provider: declared.provider, model: declared.model, topic: topicSnapshot(topic, decision),
    }), !dryRun);
  }
  const existing = await readExistingResearchPack(rootDir, options.researchDate);
  if (!dryRun && existing.state === 'valid' && existing.pack.status === 'success'
    && existing.pack.sources.length === materials.length
    && existing.pack.sources.every((source) => source.content_sha256 !== null)) {
    const priorHash = await computeResearchInputHash({
      rootDir, topicDecision: decision, materials,
      sources: existing.pack.sources.map((source) => ({ material_id: source.material_id, content_sha256: source.content_sha256! })),
      provider: declared.provider, model: declared.model,
      runtimeVersion: existing.pack.model.runtime_version,
      promptVersion: config.research.prompt_version,
    });
    if (priorHash === existing.pack.input_hash) {
      return { execution_status: 'ALREADY_RESEARCHED', pack: existing.pack, files_written: false };
    }
  }
  let sources: CleanedSourceSnapshot[] = [];
  try {
    if (fixture) sources = buildFixtureResearchSources(materials);
    else {
      for (const material of materials) {
        const source = await (options.fetchSource ?? fetchAndExtractMaterial)(material, config);
        sources.push(source);
        await writeResearchCacheSnapshot(options.cacheRoot ?? defaultResearchCacheRoot(), source);
      }
    }
  } catch (error) {
    const unsupported = typeof error === 'object' && error !== null && 'code' in error
      && error.code === 'unsupported_content_type';
    return finish(rootDir, failedPack({
      researchDate: options.researchDate,
      inputHash: fallbackResearchInputHash({ topic_input_hash: decision.input_hash, error: errorCode(error) }),
      errorCode: errorCode(error), message: error instanceof Error ? error.message : String(error),
      provider: declared.provider, model: declared.model, topic: topicSnapshot(topic, decision),
      sources: manifests(materials, sources, null),
      requestedSources: materials.length,
      failedSources: unsupported ? 0 : 1,
      unsupportedContentTypes: unsupported ? 1 : 0,
    }), !dryRun);
  }
  let provider: ResearchProvider;
  try {
    provider = options.provider ?? (fixture ? new FixtureResearchProvider() : await codexCliResearchProviderFromEnvironment());
  } catch (error) {
    return finish(rootDir, failedPack({
      researchDate: options.researchDate,
      inputHash: fallbackResearchInputHash({ topic_input_hash: decision.input_hash, sources: sources.map((source) => source.content_sha256) }),
      errorCode: errorCode(error), message: error instanceof Error ? error.message : String(error),
      provider: declared.provider, model: declared.model, topic: topicSnapshot(topic, decision),
      sources: manifests(materials, sources, null),
      requestedSources: materials.length,
    }), !dryRun);
  }
  const inputHash = await computeResearchInputHash({
    rootDir, topicDecision: decision, materials, sources,
    provider: provider.providerName, model: provider.modelName,
    runtimeVersion: provider.runtimeVersion,
    promptVersion: config.research.prompt_version,
  });
  const productTruth = await loadTopicProductTruth(rootDir);
  const productSummary = {
    positioning: productTruth.product.positioning.primary,
    selected_module: productTruth.context.deliveryModules.find(({ id }) => id === topic.primary_product_module_id) ?? null,
    allowed_claim_ids: topic.product_claim_ids.filter((claim) => productTruth.context.allowedProductClaimIds.includes(claim)),
    forbidden_claim_ids: productTruth.context.forbiddenClaimIds,
  };
  const providerInput = {
    decisionDate: options.researchDate,
    topic,
    sources,
    productSummary,
    experimentTasks: catalog.tasks,
    config,
  };
  let analysis: ResearchProviderCall<ResearchProviderResult>;
  let calls = 0;
  let durationMs = 0;
  let usage: ResearchProviderCall<unknown>['usage'] = null;
  try {
    analysis = await provider.analyze(providerInput);
    calls += 1; durationMs += analysis.durationMs; usage = usageAdd(usage, analysis.usage);
    let verified = verifyResearchProviderResult({ result: analysis.output, topic, sources, config });
    if (verified.errors.length > 0 && config.research.repair_attempts === 1) {
      analysis = await provider.repair(providerInput, verified.errors);
      calls += 1; durationMs += analysis.durationMs; usage = usageAdd(usage, analysis.usage);
      verified = verifyResearchProviderResult({ result: analysis.output, topic, sources, config });
    }
    if (verified.errors.length > 0) {
      const quoteError = verified.errors.some((message) => /quote|source_id|segment_id/.test(message));
      return finish(rootDir, failedPack({
        researchDate: options.researchDate, inputHash,
        errorCode: quoteError ? 'invalid_source_quote' : 'codex_output_invalid',
        message: verified.errors.join('; '), provider: provider.providerName, model: provider.modelName,
        runtimeVersion: provider.runtimeVersion, topic: topicSnapshot(topic, decision), calls, durationMs, usage,
        sources: manifests(materials, sources, analysis.output),
      }), !dryRun);
    }
    let experiment: ExperimentBundle | null = null;
    if (topic.requires_experiment) {
      const task = catalog.tasks.find(({ task_id }) => task_id === analysis.output.experiment_task_id);
      if (task === undefined) throw new ResearchProviderUnavailableError('codex_output_invalid');
      const run = await runExperimentBundle({
        provider,
        task,
        timeoutMs: provider.timeoutMs,
        maximumOutputChars: config.experiment.maximum_output_chars_per_variant,
      });
      experiment = run.bundle;
      calls += run.calls; durationMs += run.durationMs; usage = usageAdd(usage, run.usage);
    }
    if (calls > config.research.maximum_codex_calls) throw new ResearchProviderUnavailableError('codex_output_invalid');
    const supportedClaims = analysis.output.verified_claims.filter(({ support_status }) => support_status !== 'unsupported');
    const factClaimsVerified = topic.supported_claims.every((_claim, index) =>
      supportedClaims.some((claim) => claim.claim_id === `claim_supported_${index + 1}`
        && (!topic.time_sensitive || claim.support_status === 'direct')));
    const researchQuestionsSufficient = analysis.output.research_answers.length === topic.research_questions.length
      && analysis.output.research_answers.every(({ answer_status }) => answer_status !== 'unanswered');
    const experimentCompleted = !topic.requires_experiment || (experiment !== null
      && experiment.results.every((result) => result.status === 'success' && result.output_parse_status === 'valid')
      && experiment.limitations.length > 0);
    const openGaps = [
      ...(factClaimsVerified ? [] : ['One or more declared factual claims lack direct verified support.']),
      ...(researchQuestionsSufficient ? [] : ['One or more core research questions remain unanswered.']),
      ...(experimentCompleted ? [] : ['The required experiment did not complete with valid outputs.']),
    ];
    const pack = researchPackSchema.parse({
      version: 1,
      research_date: options.researchDate,
      run_id: runId(),
      status: 'success',
      decision: openGaps.length === 0 ? 'READY_FOR_WRITING' : 'RESEARCH_INCOMPLETE',
      topic: topicSnapshot(topic, decision),
      input_hash: inputHash,
      source_summary: { requested: materials.length, fetched: sources.length, failed: 0, unsupported_content_type: 0 },
      sources: manifests(materials, sources, analysis.output),
      verified_claims: supportedClaims,
      research_answers: analysis.output.research_answers,
      experiment,
      writing_requirements: finalizedRequirements(topic, analysis.output, experiment),
      readiness: { fact_claims_verified: factClaimsVerified, research_questions_sufficient: researchQuestionsSufficient, experiment_completed: experimentCompleted, open_gaps: openGaps },
      model: { provider: provider.providerName, model: provider.modelName, runtime_version: provider.runtimeVersion, calls, duration_ms: durationMs, usage },
      error_code: null, error_message_safe: null, created_at: new Date().toISOString(),
    });
    return finish(rootDir, pack, !dryRun);
  } catch (error) {
    return finish(rootDir, failedPack({
      researchDate: options.researchDate, inputHash, errorCode: errorCode(error),
      message: error instanceof Error ? error.message : String(error),
      provider: provider.providerName, model: provider.modelName, runtimeVersion: provider.runtimeVersion,
      topic: topicSnapshot(topic, decision), calls, durationMs, usage, sources: manifests(materials, sources, null),
    }), !dryRun);
  }
}
