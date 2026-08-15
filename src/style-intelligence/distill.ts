import { z } from 'zod';
import { computeRhythmMetrics } from './rhythm-metrics.js';
import { buildStyleInputBudget } from './input-budget.js';
import { requiredPublicReferenceForbiddenTransfers, styleProfileSchema, type StyleProfile, type StyleQualitative } from './schemas.js';
import { computeStyleCorpusHash, stableJson } from './hash.js';
import {
  StyleProviderOutputError,
  styleDistillationBundleSchema,
  type StyleDistillationBundle,
  type StyleDistillInput,
  type StyleDistillProvider,
} from './provider.js';
import { buildProtectedTransferIndex, type ProtectedTransferIndex } from './protected-transfer.js';
import type { CorpusDocument } from './types.js';

const emptyQualitative: StyleQualitative = {
  voice_signals: [], structural_patterns: [], explanation_patterns: [], evidence_patterns: [], cta_patterns: [],
  positive_rules: [], anti_patterns: [], preferred_terms: [],
  content_pattern_profile: { topic_entries: [], problem_definitions: [], evidence_placement: [], progression_patterns: [], ending_patterns: [] },
  language_style_profile: { rhythm_observations: [], first_person_usage: [], question_usage: [], transition_patterns: [], abstraction_and_action: [], judgment_and_uncertainty: [], humor_and_asides: [] },
  conversion_pattern_profile: { cta_positions: [], cta_length_patterns: [], free_value_completeness: [], product_connections: [], anxiety_patterns: [], omitted_step_patterns: [] },
  confidence: 0,
};

function sourceFragment(value: string, documents: readonly CorpusDocument[]): boolean {
  const normalizedValue = value.replace(/\s+/gu, '');
  if (normalizedValue.length < 12) return false;
  return documents.some(({ text }) => text.replace(/\s+/gu, '').includes(normalizedValue));
}

function unsafeReferenceDetail(value: string, documents: readonly CorpusDocument[], protectedTexts: readonly string[]): boolean {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, '');
  return sourceFragment(value, documents)
    || protectedTexts.some((text) => normalized.includes(text.normalize('NFKC').replace(/\s+/gu, '')))
    || /(?:https?:\/\/|我|我的|我们|当年|曾经|客户|学员|学生|20\d{2}年|收入|项目金额)/u.test(value);
}

function sanitizePublicReference(qualitative: StyleQualitative, documents: readonly CorpusDocument[], protectedTexts: readonly string[]): StyleQualitative {
  const clean = (values: string[]) => values.filter((value) => !unsafeReferenceDetail(value, documents, protectedTexts));
  return {
    ...qualitative,
    voice_signals: [],
    structural_patterns: clean(qualitative.structural_patterns),
    explanation_patterns: clean(qualitative.explanation_patterns),
    evidence_patterns: clean(qualitative.evidence_patterns),
    cta_patterns: clean(qualitative.cta_patterns),
    positive_rules: clean(qualitative.positive_rules),
    anti_patterns: clean(qualitative.anti_patterns),
    preferred_terms: [],
    content_pattern_profile: Object.fromEntries(Object.entries(qualitative.content_pattern_profile).map(([key, values]) => [key, clean(values)])) as StyleQualitative['content_pattern_profile'],
    language_style_profile: Object.fromEntries(Object.entries(qualitative.language_style_profile).map(([key, values]) => [key, clean(values)])) as StyleQualitative['language_style_profile'],
    conversion_pattern_profile: Object.fromEntries(Object.entries(qualitative.conversion_pattern_profile).map(([key, values]) => [key, clean(values)])) as StyleQualitative['conversion_pattern_profile'],
  };
}

function publicReferenceAuditFailures(qualitative: StyleQualitative, documents: readonly CorpusDocument[], protectedTexts: readonly string[]): string[] {
  const failures = qualitativeStrings(qualitative).filter((value) => unsafeReferenceDetail(value, documents, protectedTexts));
  return failures.length === 0 ? [] : ['public_reference_profile_contains_forbidden_transfer'];
}

function qualitativeStrings(qualitative: StyleQualitative): string[] {
  return Object.entries(qualitative).flatMap(([, value]) => {
    if (Array.isArray(value)) return value as string[];
    if (value !== null && typeof value === 'object') return Object.values(value).flatMap((nested) => Array.isArray(nested) ? nested as string[] : []);
    return [];
  });
}

function ownerAuditFailures(qualitative: StyleQualitative, documents: readonly CorpusDocument[]): string[] {
  const failures = new Set<string>();
  for (const value of qualitativeStrings(qualitative)) {
    if (/https?:\/\//iu.test(value)) failures.add('owner_profile_contains_url');
    if (/\b(?:19|20)\d{2}年?/u.test(value)) failures.add('owner_profile_contains_year_event');
    if (/(?:¥|￥|\d+(?:\.\d+)?\s*(?:元|万元|万块|收入|营收))/u.test(value)) failures.add('owner_profile_contains_money_or_income');
    if (/(?:我.{0,30}(?:客户|学员|学生)|(?:客户|学员|学生).{0,30}(?:我|他|她|给|买|付|说|做|赚|项目|故事|案例|收入|带过))/u.test(value)) failures.add('owner_profile_contains_client_or_student_story');
    if (/(?:去年|上周|昨天|当年|曾经|那次|我在|我曾|我们曾).{0,40}(?:做|带|赚|接|卖|买|遇到|经历|发生|完成|改了)/u.test(value)) failures.add('owner_profile_contains_personal_event');
    if (/\d+(?:\.\d+)?(?:%|次|分钟|小时|天|个|人|项目)/u.test(value)) failures.add('owner_profile_contains_concrete_fact');
    if (sourceFragment(value, documents)) failures.add('owner_profile_contains_source_sentence');
  }
  return [...failures];
}

function assertConsistentCorpus(documents: readonly CorpusDocument[]): CorpusDocument {
  const first = documents[0];
  if (first === undefined) throw new Error('style_corpus_empty');
  for (const document of documents) {
    if (document.profile_id !== first.profile_id || document.profile_type !== first.profile_type || document.rights_status !== first.rights_status) throw new Error('style_corpus_profile_mismatch');
  }
  if (first.rights_status === 'public_reference' && first.profile_type !== 'reference_technique') throw new Error('public_reference_requires_reference_technique');
  return first;
}

function parseBundle(value: unknown): StyleDistillationBundle {
  try { return styleDistillationBundleSchema.parse(value); }
  catch (error) {
    if (error instanceof z.ZodError) throw new StyleProviderOutputError();
    throw error;
  }
}

function sameProtectedEntries(left: ProtectedTransferIndex, right: ProtectedTransferIndex): boolean {
  return left.profile_id === right.profile_id && left.corpus_hash === right.corpus_hash && stableJson(left.entries) === stableJson(right.entries);
}

interface AuditedBundle {
  qualitative: StyleQualitative;
  protectedIndex: ProtectedTransferIndex | null;
  failures: string[];
}

function auditBundle(
  bundle: StyleDistillationBundle,
  documents: readonly CorpusDocument[],
  first: CorpusDocument,
  createdAt: string,
  existingProtectedIndex: ProtectedTransferIndex | undefined,
): AuditedBundle {
  const failures: string[] = [];
  let protectedIndex: ProtectedTransferIndex | null = null;
  if (first.rights_status === 'public_reference') {
    try {
      const built = buildProtectedTransferIndex(documents, bundle.protected_transfer_candidates, createdAt);
      protectedIndex = existingProtectedIndex !== undefined && sameProtectedEntries(existingProtectedIndex, built) ? existingProtectedIndex : built;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'protected_candidate_audit_failed');
    }
  } else {
    if (bundle.protected_transfer_candidates.length > 0) failures.push('protected_candidates_not_allowed_for_owned_or_licensed_corpus');
    failures.push(...ownerAuditFailures(bundle.profile_fragment, documents));
  }
  return { qualitative: bundle.profile_fragment, protectedIndex, failures: [...new Set(failures)] };
}

export interface DistillProfileOptions {
  documents: CorpusDocument[];
  provider?: StyleDistillProvider;
  existingProtectedIndex?: ProtectedTransferIndex;
  createdAt?: string;
  version?: number;
}

export interface DistillProfileResult {
  profile: StyleProfile;
  protected_index: ProtectedTransferIndex | null;
  model_calls: number;
}

export async function distillStyleProfile(options: DistillProfileOptions): Promise<DistillProfileResult> {
  const first = assertConsistentCorpus(options.documents);
  const documents = [...options.documents].sort((left, right) => left.document_id.localeCompare(right.document_id));
  const metrics = computeRhythmMetrics(documents);
  const corpusHash = computeStyleCorpusHash(documents);
  const processingAllowed = documents.length > 0 && documents.every(({ model_processing }) => model_processing.allowed && model_processing.provider_scope === 'codex_cli');
  const budget = buildStyleInputBudget(documents, processingAllowed);
  const createdAt = options.createdAt ?? new Date().toISOString();
  let qualitative = emptyQualitative;
  let protectedIndex = first.rights_status === 'public_reference'
    && options.existingProtectedIndex?.profile_id === first.profile_id
    && options.existingProtectedIndex.corpus_hash === corpusHash
    ? options.existingProtectedIndex : null;
  let modelCalls = 0;
  if (documents.length >= 8 && processingAllowed) {
    if (options.provider === undefined) throw new Error('style_provider_required_for_ready_profile');
    const input: StyleDistillInput = {
      profile_id: first.profile_id,
      profile_type: first.profile_type,
      rights_status: first.rights_status,
      quantitative_features: metrics,
      documents: budget.documents,
    };
    let bundle: StyleDistillationBundle;
    try {
      modelCalls += 1;
      bundle = parseBundle(await options.provider.distill(input));
    } catch (error) {
      if (!(error instanceof StyleProviderOutputError)) throw error;
      modelCalls += 1;
      bundle = parseBundle(await options.provider.repair(input, ['style_provider_output_invalid']));
    }
    let audited = auditBundle(bundle, documents, first, createdAt, options.existingProtectedIndex);
    if (audited.failures.length > 0 && modelCalls < 2) {
      modelCalls += 1;
      bundle = parseBundle(await options.provider.repair(input, audited.failures));
      audited = auditBundle(bundle, documents, first, createdAt, options.existingProtectedIndex);
    }
    if (audited.failures.length > 0) throw new Error(`style_profile_content_audit_failed:${audited.failures.join(',')}`);
    qualitative = audited.qualitative;
    protectedIndex = audited.protectedIndex;
  }
  if (first.rights_status === 'public_reference') {
    const protectedTexts = protectedIndex?.entries.map(({ text }) => text) ?? [];
    qualitative = sanitizePublicReference(qualitative, documents, protectedTexts);
    const failures = publicReferenceAuditFailures(qualitative, documents, protectedTexts);
    if (failures.length > 0) throw new Error(`style_profile_content_audit_failed:${failures.join(',')}`);
  }
  if (modelCalls > 2) throw new Error('style_codex_call_limit_exceeded');
  qualitative = { ...qualitative, confidence: Math.min(qualitative.confidence, Math.max(0.25, budget.coverage.coverage_ratio)) };
  const forbidden = first.rights_status === 'public_reference' ? [...requiredPublicReferenceForbiddenTransfers] : ['factual_claim'] as const;
  const protectedIndexReady = first.rights_status === 'public_reference' && protectedIndex?.profile_id === first.profile_id && protectedIndex.corpus_hash === corpusHash;
  const status = !processingAllowed ? 'processing_not_allowed' : documents.length < 8 ? 'insufficient_samples' : 'ready';
  const profile = styleProfileSchema.parse({
    profile_id: first.profile_id,
    profile_type: first.profile_type,
    rights_status: first.rights_status,
    status,
    platforms: [...new Set(documents.map(({ platform }) => platform))].sort(),
    content_types: [...new Set(documents.map(({ content_type }) => content_type))].sort(),
    sample_count: documents.length,
    corpus_hash: corpusHash,
    model_input_hash: budget.modelInputHash,
    input_coverage: budget.coverage,
    protected_index_status: first.rights_status === 'public_reference' ? protectedIndexReady ? 'ready' : 'missing' : 'not_required',
    quantitative_features: metrics,
    ...qualitative,
    forbidden_transfer: forbidden,
    created_at: createdAt,
    version: options.version ?? 1,
  });
  return { profile, protected_index: protectedIndex, model_calls: modelCalls };
}
