import os from 'node:os';
import path from 'node:path';
import { adaptHumanWriting } from '../writing-skills/human-writing-adapter.js';
import { guardAgainstPlagiarism } from '../writing-lint/plagiarism-guard.js';
import { resolveAuthorizedResearchQuotes } from '../writing-lint/authorized-research-quotes.js';
import type { ResearchPack } from '../research/schemas.js';
import { loadProductProfile } from '../product/load-product-profile.js';
import { sha256, stableJson } from '../style-intelligence/hash.js';
import type { ArticleType } from '../style-intelligence/schemas.js';
import { blockingAuditIssues, runDeterministicWritingAudits, withPlagiarismAudit } from './audits.js';
import { loadWritingIntelligenceConfig } from './config.js';
import { CodexCliWritingProvider, FixtureWritingProvider, WritingProviderError, codexCliWritingProviderFromEnvironment, type WritingProvider } from './provider.js';
import { loadReferenceGuardInputsReadOnly } from './reference-guard.js';
import { renderWriterOutput } from './render.js';
import { evaluateResearchGate } from './research-gate.js';
import {
  resolvedWritingStyleSnapshot,
  resolveStyleApprovalChain,
  type ResolvedWritingStyle,
  type ResolveStyleApprovalOptions,
} from './style-approval-resolver.js';
import { buildWritingStyleRecipes } from './style-recipe.js';
import { writeProductionWritingPack, writeSyntheticReviewPack, writeTemporaryWritingPack } from './storage.js';
import { writingPackSchema, writerOutputSchema, type WriterOutput, type WritingPack } from './schemas.js';

interface SimpleIssue { issue_code: string; severity: 'hard_blocker' | 'blocking_style_issue' | 'warning' | 'profile_preference'; location: string; quoted_text: string; repair_constraint: string }

export interface RunWritingBuildOptions {
  rootDir?: string;
  writingDate: string;
  dryRun?: boolean;
  fixture?: boolean;
  syntheticReadyFixture?: boolean;
  styleProfilePath?: string;
  approvalReceiptPath?: string;
  bindingAttestationPath?: string;
  allowProvisionalStyle?: boolean;
  provider?: WritingProvider;
  providerFactory?: () => Promise<WritingProvider>;
  resolvedStyle?: ResolvedWritingStyle;
  expectedStyleHashes?: ResolveStyleApprovalOptions['expectedHashes'];
  corpusRoot?: string;
  skipReferenceGuardForFixture?: boolean;
  writeOutputs?: boolean;
  reviewPackRoot?: string;
  now?: Date;
}

export interface RunWritingBuildResult {
  execution_status: 'READY' | 'BLOCKED' | 'WAITING' | 'FAILED';
  pack: WritingPack;
  files_written: boolean;
  repository_files: string[];
  temporary_output_directory: string | null;
  review_pack_directory: string | null;
}

function runId(now: Date): string { return `writing_${now.toISOString().replace(/[:.]/g, '-')}`; }
function usageAdd(left: WritingPack['model']['usage'], right: WritingPack['model']['usage']): WritingPack['model']['usage'] {
  if (left === null) return right;
  if (right === null) return left;
  const add = (a: number | null, b: number | null) => a === null || b === null ? null : a + b;
  return { input_tokens: add(left.input_tokens, right.input_tokens), output_tokens: add(left.output_tokens, right.output_tokens), total_tokens: add(left.total_tokens, right.total_tokens) };
}

function researchSnapshot(pack: ResearchPack | null) {
  return {
    research_run_id: pack?.run_id ?? null,
    research_input_hash: pack?.input_hash ?? null,
    research_decision: pack?.decision ?? null,
    topic_signature: pack?.topic?.topic_signature ?? null,
  };
}

function basePack(options: { writingDate: string; now: Date; research: ResearchPack | null; synthetic: boolean }): Omit<WritingPack, 'status' | 'decision' | 'style' | 'master_draft' | 'wechat' | 'x' | 'audits' | 'model' | 'error_code' | 'error_message_safe'> {
  return {
    version: 1,
    writing_date: options.writingDate,
    run_id: runId(options.now),
    input_hash: sha256(stableJson({ writing_date: options.writingDate, research_input_hash: options.research?.input_hash ?? null, synthetic_fixture: options.synthetic })),
    synthetic_fixture: options.synthetic,
    not_for_publication: options.synthetic,
    research: researchSnapshot(options.research),
    human_gate: { required: true, status: 'unreviewed', automated_publish_allowed: false },
    created_at: options.now.toISOString(),
  };
}

function emptyModel(): WritingPack['model'] { return { provider: 'none', model: '', runtime_version: null, calls: 0, duration_ms: 0, usage: null }; }

function earlyResult(base: ReturnType<typeof basePack>, decision: 'BLOCKED_BY_RESEARCH' | 'NO_CONTENT' | 'WAITING_FOR_RESEARCH' | 'WAITING_FOR_APPROVED_STYLE'): RunWritingBuildResult {
  const pack = writingPackSchema.parse({ ...base, status: 'success', decision, style: null, master_draft: null, wechat: null, x: null, audits: null, model: emptyModel(), error_code: null, error_message_safe: null });
  return { execution_status: decision === 'BLOCKED_BY_RESEARCH' ? 'BLOCKED' : 'WAITING', pack, files_written: false, repository_files: [], temporary_output_directory: null, review_pack_directory: null };
}

function failedResult(base: ReturnType<typeof basePack>, code: WritingPack['error_code'], model: WritingPack['model'], style: WritingPack['style'] = null, safeMessage: string | null = code): RunWritingBuildResult {
  const pack = writingPackSchema.parse({ ...base, status: 'failed', decision: null, style, master_draft: null, wechat: null, x: null, audits: null, model, error_code: code, error_message_safe: safeMessage });
  return { execution_status: 'FAILED', pack, files_written: false, repository_files: [], temporary_output_directory: null, review_pack_directory: null };
}

function articleTypeForResearch(research: ResearchPack): ArticleType {
  if (research.experiment?.spec.task_id === 'meeting_notes_to_decision_log') return 'tutorial';
  if (research.topic?.content_pillar === 'projects_cases_and_templates') return 'case_breakdown';
  if (research.topic?.content_pillar === 'orientation_and_selection') return 'checklist';
  return 'analysis';
}

function xFormatForResearch(articleType: ArticleType, research: ResearchPack): 'single_post' | 'thread' | 'debate_prompt' {
  if (articleType === 'tutorial' || articleType === 'checklist') return 'thread';
  if (articleType === 'opinion' && research.research_answers.some(({ question }) => /争议|是否|还是/u.test(question))) return 'debate_prompt';
  return 'single_post';
}

function effectiveCtaMode(research: ResearchPack): 'none' | 'light' { return research.topic?.cta_mode === 'none' ? 'none' : 'light'; }

function publicResearchInput(research: ResearchPack) {
  return {
    topic: research.topic === null ? null : { working_title: research.topic.working_title, cta_mode: research.topic.cta_mode },
    verified_claims: research.verified_claims.map(({ claim_id, claim, support_status, scope_limit }) => ({ claim_id, claim, support_status, scope_limit })),
    experiment: research.experiment === null ? null : {
      results: research.experiment.results.map(({ variant_id, criterion_pass_count, criterion_fail_count, missing_required_fields }) => ({ variant_id, criterion_pass_count, criterion_fail_count, missing_required_fields })),
      observable_differences: research.experiment.observable_differences,
      limitations: research.experiment.limitations,
    },
    writing_requirements: research.writing_requirements,
  };
}

function structuralIssues(output: WriterOutput, rendered: ReturnType<typeof renderWriterOutput>, articleType: ArticleType, xFormat: ReturnType<typeof xFormatForResearch>, minimum: number, maximum: number, maxX: number): SimpleIssue[] {
  const issues: SimpleIssue[] = [];
  const add = (issue_code: string, location: string, quoted_text: string, repair_constraint: string) => issues.push({ issue_code, location, quoted_text, repair_constraint, severity: 'hard_blocker' });
  const firstBlock = output.blocks[0]!.block_id;
  const boundaryBlock = output.blocks.find(({ block_type }) => block_type === 'boundary')?.block_id ?? firstBlock;
  const ctaBlock = output.blocks.find(({ block_type }) => block_type === 'cta')?.block_id ?? output.blocks.at(-1)!.block_id;
  if (output.article_type !== articleType) add('article_type_mismatch', firstBlock, output.article_type, `Use the planned ${articleType} structure.`);
  if (rendered.wechat.chinese_character_count < minimum || rendered.wechat.chinese_character_count > maximum) add('wechat_length_out_of_range', boundaryBlock, String(rendered.wechat.chinese_character_count), `Keep the rendered WeChat body between ${minimum} and ${maximum} Chinese characters without new facts.`);
  if (output.x.format !== xFormat) add('x_format_mismatch', ctaBlock, output.x.format, `Return only the planned ${xFormat} format.`);
  const items = output.x.format === 'thread' ? output.x.thread : [output.x.single_post ?? output.x.debate_prompt ?? ''];
  if (items.some((item) => [...item].filter((character) => /\p{Script=Han}/u.test(character)).length > maxX)) add('x_item_too_long', ctaBlock, '', `Each X item must be at most ${maxX} Chinese characters.`);
  if (output.visual_slots.some(({ generation_status }) => generation_status !== 'not_started')) add('visual_generation_attempted', 'visual_slots', '', 'Visual slots are planning only.');
  return issues;
}

function stylePack(style: ReturnType<typeof resolvedWritingStyleSnapshot>, recipes: ReturnType<typeof buildWritingStyleRecipes>): NonNullable<WritingPack['style']> {
  return {
    style_status: style.style_status,
    approval_chain_status: style.approval_chain_status,
    provisional_style_used: style.style_status === 'provisional_approved_with_pending_items',
    production_eligible: style.production_eligible,
    profile_ids: style.profile_ids,
    profile_versions: style.profile_versions,
    profile_hashes: style.profile_hashes,
    receipt_sha256: style.receipt_hash,
    attestation_sha256: style.attestation_hash,
    decision_set_sha256: style.decision_set_hash,
    recipe_hash: recipes.recipe_hash,
    selected_rule_ids: recipes.selected_rule_ids,
    excluded_rule_ids: style.excluded_rule_ids,
    deleted_rule_ids: style.deleted_rule_ids,
    owner_profile_scope: style.style_scope,
    platform_fidelity: style.platform_fidelity,
    confidence: style.confidence_label,
  };
}

export function repairTargets(output: WriterOutput, issues: readonly SimpleIssue[]) {
  const targets = new Map<string, { block_id: string; text: string; constraints: string[] }>();
  for (const item of issues) {
    const explicit = /block_[a-z0-9_-]+/u.exec(item.location)?.[0];
    const byQuote = item.quoted_text === '' ? undefined : output.blocks.find(({ text }) => text.includes(item.quoted_text))?.block_id;
    const blockId = explicit ?? byQuote ?? (item.issue_code.includes('limitation') ? output.blocks.find(({ block_type }) => block_type === 'boundary')?.block_id : undefined);
    if (blockId === undefined) continue;
    const block = output.blocks.find(({ block_id }) => block_id === blockId);
    if (block === undefined) continue;
    const current = targets.get(blockId) ?? { block_id: blockId, text: block.text, constraints: [] };
    current.constraints.push(item.repair_constraint);
    targets.set(blockId, current);
  }
  return [...targets.values()];
}

export function applyRepair(output: WriterOutput, targets: ReturnType<typeof repairTargets>, repaired: Awaited<ReturnType<WritingProvider['repair']>>['output']): WriterOutput {
  const allowed = new Set(targets.map(({ block_id }) => block_id));
  if (repaired.repaired_blocks.some(({ block_id }) => !allowed.has(block_id))) throw new Error('repair_modified_unlisted_block');
  const replacements = new Map(repaired.repaired_blocks.map(({ block_id, text }) => [block_id, text]));
  return writerOutputSchema.parse({ ...output, blocks: output.blocks.map((block) => replacements.has(block.block_id) ? { ...block, text: replacements.get(block.block_id)! } : block) });
}

export async function runWritingBuild(options: RunWritingBuildOptions): Promise<RunWritingBuildResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const now = options.now ?? new Date();

  // This must remain the first dependency boundary: no Style file, model env, Provider, or writing config is touched above it.
  const gate = await evaluateResearchGate({ rootDir, writingDate: options.writingDate, ...(options.syntheticReadyFixture === undefined ? {} : { syntheticReadyFixture: options.syntheticReadyFixture }) });
  const base = basePack({ writingDate: options.writingDate, now, research: gate.pack, synthetic: options.syntheticReadyFixture === true });
  if (gate.gate_decision !== 'READY') return earlyResult(base, gate.writing_decision!);
  const research = gate.pack!;

  const hasExplicitStyleInputs = options.styleProfilePath !== undefined && options.approvalReceiptPath !== undefined && options.bindingAttestationPath !== undefined;
  if (options.resolvedStyle === undefined && (!hasExplicitStyleInputs || options.allowProvisionalStyle !== true)) return earlyResult(base, 'WAITING_FOR_APPROVED_STYLE');
  if (options.resolvedStyle === undefined && options.dryRun !== true && options.syntheticReadyFixture !== true) return earlyResult(base, 'WAITING_FOR_APPROVED_STYLE');

  let resolvedStyle: ResolvedWritingStyle;
  try {
    resolvedStyle = options.resolvedStyle ?? await resolveStyleApprovalChain({
      repositoryRoot: rootDir,
      researchGateAllowed: true,
      styleProfilePath: options.styleProfilePath!, approvalReceiptPath: options.approvalReceiptPath!, bindingAttestationPath: options.bindingAttestationPath!,
      ...(options.expectedStyleHashes === undefined ? {} : { expectedHashes: options.expectedStyleHashes }),
    });
  } catch { return failedResult(base, 'style_approval_chain_invalid', emptyModel()); }

  const style = resolvedWritingStyleSnapshot(resolvedStyle);
  if (style.style_status === 'provisional_approved_with_pending_items' && options.dryRun !== true && options.syntheticReadyFixture !== true) return earlyResult(base, 'WAITING_FOR_APPROVED_STYLE');
  const config = await loadWritingIntelligenceConfig(rootDir);
  let product;
  try { product = await loadProductProfile(rootDir); }
  catch { return failedResult(base, 'configuration_invalid', emptyModel(), stylePack(style, buildWritingStyleRecipes(resolvedStyle, articleTypeForResearch(research), config))); }
  const articleType = articleTypeForResearch(research);
  const recipes = buildWritingStyleRecipes(resolvedStyle, articleType, config);
  const packStyle = stylePack(style, recipes);
  const xFormat = xFormatForResearch(articleType, research);
  const ctaMode = effectiveCtaMode(research);
  const materialCount = research.sources.length + research.verified_claims.length + research.research_answers.length + (research.experiment?.results.length ?? 0);
  const humanPreDraft = adaptHumanWriting({ article_type: articleType, material_count: materialCount, factual_mode: 'nonfiction' }, 'pre_draft');
  const writerInput = {
    writing_date: options.writingDate,
    article_type: articleType,
    x_format: xFormat,
    effective_cta_mode: ctaMode,
    price_in_public_copy: false,
    research: publicResearchInput(research),
    selected_style_rules: { wechat: recipes.wechat.selected_rules, x: recipes.x.selected_rules },
    selected_style_rule_ids: recipes.selected_rule_ids,
    human_writing_pre_draft: humanPreDraft,
    owner_profile_scope: style.style_scope,
    platform_fidelity: style.platform_fidelity,
    human_gate: { required: true, automated_publish_allowed: false },
  };

  let provider: WritingProvider;
  try { provider = options.provider ?? await (options.providerFactory ?? (options.fixture ? async () => new FixtureWritingProvider() : () => codexCliWritingProviderFromEnvironment()))(); }
  catch (error) { return failedResult(base, error instanceof WritingProviderError ? error.code as WritingPack['error_code'] : 'codex_process_failed', emptyModel(), packStyle, error instanceof WritingProviderError ? error.safeMessage : 'codex_process_failed'); }
  let calls = 0;
  let duration = 0;
  let usage: WritingPack['model']['usage'] = null;
  const model = (): WritingPack['model'] => ({ provider: provider.providerName, model: provider.modelName, runtime_version: provider.runtimeVersion, calls, duration_ms: duration, usage });
  const record = <T>(call: { output: T; durationMs: number; usage: WritingPack['model']['usage'] }) => { calls += 1; duration += call.durationMs; usage = usageAdd(usage, call.usage); return call.output; };

  let output: WriterOutput;
  try { output = record(await provider.write(writerInput)); }
  catch (error) { return failedResult(base, error instanceof WritingProviderError ? error.code as WritingPack['error_code'] : 'writing_output_invalid', model(), packStyle, error instanceof WritingProviderError ? error.safeMessage : 'writing_output_invalid'); }
  if (calls > 3) return failedResult(base, 'writing_output_invalid', model(), packStyle);
  if (ctaMode === 'none') output = writerOutputSchema.parse({ ...output, cta: { mode: 'none', text: '' } });

  let rendered = renderWriterOutput(output, research);
  let qualityIssues = structuralIssues(output, rendered, articleType, xFormat, config.writing.minimum_wechat_chinese_chars, config.writing.maximum_wechat_chinese_chars, config.writing.maximum_x_chinese_chars);
  let audits = runDeterministicWritingAudits({ ...rendered, research, product, recipes, style, qualityIssues });
  try {
    const reviewer = record(await provider.review({
      output, audits, constraints: { article_type: articleType, x_format: xFormat, effective_cta_mode: ctaMode, human_gate_required: true, no_full_rewrite: true },
    }));
    qualityIssues = [...qualityIssues, ...reviewer.issues];
  } catch (error) { return failedResult(base, error instanceof WritingProviderError ? error.code as WritingPack['error_code'] : 'writing_output_invalid', model(), packStyle, error instanceof WritingProviderError ? error.safeMessage : 'writing_output_invalid'); }
  audits = runDeterministicWritingAudits({ ...rendered, research, product, recipes, style, qualityIssues });

  let blockers = blockingAuditIssues(audits);
  if (blockers.length > 0) {
    const targets = repairTargets(output, blockers);
    if (targets.length === 0 || calls >= 3) return failedResult(base, 'writing_audit_failed', model(), packStyle);
    try { output = applyRepair(output, targets, record(await provider.repair({ blocks: targets, no_new_facts: true, preserve_block_metadata: true }))); }
    catch (error) { return failedResult(base, error instanceof WritingProviderError ? error.code as WritingPack['error_code'] : 'writing_output_invalid', model(), packStyle, error instanceof WritingProviderError ? error.safeMessage : 'writing_output_invalid'); }
    rendered = renderWriterOutput(output, research);
    const remainingWarnings = qualityIssues.filter(({ severity }) => severity === 'warning' || severity === 'profile_preference');
    const newStructural = structuralIssues(output, rendered, articleType, xFormat, config.writing.minimum_wechat_chinese_chars, config.writing.maximum_wechat_chinese_chars, config.writing.maximum_x_chinese_chars);
    audits = runDeterministicWritingAudits({ ...rendered, research, product, recipes, style, qualityIssues: [...remainingWarnings, ...newStructural] });
    blockers = blockingAuditIssues(audits);
    if (blockers.length > 0) return failedResult(base, 'writing_audit_failed', model(), packStyle);
  }
  if (calls > 3) return failedResult(base, 'writing_output_invalid', model(), packStyle);

  try {
    const authorizedResearchQuotes = resolveAuthorizedResearchQuotes(research, { allowPartialClaimIds: research.verified_claims.filter(({ support_status }) => support_status === 'partial').map(({ claim_id }) => claim_id) });
    const guardInputs = options.fixture === true && options.skipReferenceGuardForFixture !== false
      ? (await import('../style-intelligence/protected-transfer.js')).resolveFixtureProtectedTransferIndexes()
      : null;
    const guard = guardInputs === null
      ? await loadReferenceGuardInputsReadOnly(options.corpusRoot ?? path.resolve(path.dirname(options.styleProfilePath!), '..', '..', '..'), style.profile_ids.reference)
      : { corpus: [], protectedIndexes: guardInputs };
    const result = guardAgainstPlagiarism({ draft: `${rendered.wechat.article_markdown}\n${rendered.x.single_post ?? rendered.x.debate_prompt ?? rendered.x.thread.join('\n')}`, corpus: guard.corpus, protectedIndexes: guard.protectedIndexes, authorizedResearchQuotes });
    audits = withPlagiarismAudit(audits, result);
    if (result.status === 'blocked') return failedResult(base, audits.plagiarism.protected_transfer_detected ? 'protected_transfer_detected' : 'reference_overlap_detected', model(), packStyle);
  } catch {
    return failedResult(base, 'writing_audit_failed', model(), packStyle);
  }

  const pack = writingPackSchema.parse({
    ...base, status: 'success', decision: 'READY_FOR_HUMAN_REVIEW', style: packStyle,
    master_draft: rendered.master, wechat: rendered.wechat, x: rendered.x, audits,
    model: model(), error_code: null, error_message_safe: null,
  });
  let temporaryOutput: string | null = null;
  let reviewPack: string | null = null;
  let repositoryFiles: string[] = [];
  if (options.writeOutputs !== false) {
    if (pack.style!.provisional_style_used) {
      temporaryOutput = await writeTemporaryWritingPack(pack);
      if (options.syntheticReadyFixture === true && provider instanceof CodexCliWritingProvider) {
        reviewPack = await writeSyntheticReviewPack(pack, options.reviewPackRoot ?? path.join(os.homedir(), 'Library', 'Application Support', 'AiAutoContent', 'writing-review', 'pr8-synthetic-live'));
      }
    } else if (!options.dryRun) repositoryFiles = await writeProductionWritingPack(rootDir, pack);
  }
  return { execution_status: 'READY', pack, files_written: repositoryFiles.length > 0, repository_files: repositoryFiles, temporary_output_directory: temporaryOutput, review_pack_directory: reviewPack };
}
