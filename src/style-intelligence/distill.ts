import { computeRhythmMetrics } from './rhythm-metrics.js';
import { requiredPublicReferenceForbiddenTransfers, styleProfileSchema, styleQualitativeSchema, type StyleProfile, type StyleQualitative } from './schemas.js';
import { sha256, stableJson } from './hash.js';
import { StyleProviderOutputError, type StyleDistillInput, type StyleDistillProvider } from './provider.js';
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

function unsafeReferenceDetail(value: string, documents: readonly CorpusDocument[]): boolean {
  return sourceFragment(value, documents) || /(?:我|我的|我们|当年|曾经|客户|学员|学生|20\d{2}年)/u.test(value);
}

function sanitizeList(values: string[], documents: readonly CorpusDocument[]): string[] {
  return values.filter((value) => !unsafeReferenceDetail(value, documents));
}

function sanitizePublicReference(qualitative: StyleQualitative, documents: readonly CorpusDocument[]): StyleQualitative {
  const clean = (values: string[]) => sanitizeList(values, documents);
  return {
    ...qualitative,
    voice_signals: clean(qualitative.voice_signals),
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

function assertConsistentCorpus(documents: readonly CorpusDocument[]): CorpusDocument {
  const first = documents[0];
  if (first === undefined) throw new Error('style_corpus_empty');
  for (const document of documents) {
    if (document.profile_id !== first.profile_id || document.profile_type !== first.profile_type || document.rights_status !== first.rights_status) {
      throw new Error('style_corpus_profile_mismatch');
    }
  }
  if (first.rights_status === 'public_reference' && first.profile_type !== 'reference_technique') {
    throw new Error('public_reference_requires_reference_technique');
  }
  return first;
}

export interface DistillProfileOptions {
  documents: CorpusDocument[];
  provider?: StyleDistillProvider;
  createdAt?: string;
  version?: number;
}

export async function distillStyleProfile(options: DistillProfileOptions): Promise<{ profile: StyleProfile; model_calls: number }> {
  const first = assertConsistentCorpus(options.documents);
  const documents = [...options.documents].sort((left, right) => left.document_id.localeCompare(right.document_id));
  const metrics = computeRhythmMetrics(documents);
  const corpusHash = sha256(stableJson(documents.map(({ document_id, text }) => ({ document_id, text }))));
  let qualitative = emptyQualitative;
  let modelCalls = 0;
  if (documents.length >= 8) {
    if (options.provider === undefined) throw new Error('style_provider_required_for_ready_profile');
    const input: StyleDistillInput = {
      profile_id: first.profile_id,
      profile_type: first.profile_type,
      rights_status: first.rights_status,
      quantitative_features: metrics,
      documents,
    };
    try {
      modelCalls += 1;
      qualitative = styleQualitativeSchema.parse(await options.provider.distill(input));
    } catch (error) {
      if (!(error instanceof StyleProviderOutputError)) throw error;
      modelCalls += 1;
      qualitative = styleQualitativeSchema.parse(await options.provider.repair(input, ['style_provider_output_invalid']));
    }
  }
  if (first.rights_status === 'public_reference') qualitative = sanitizePublicReference(qualitative, documents);
  if (modelCalls > 2) throw new Error('style_codex_call_limit_exceeded');
  const forbidden = first.rights_status === 'public_reference'
    ? [...requiredPublicReferenceForbiddenTransfers]
    : ['factual_claim'] as const;
  const profile = styleProfileSchema.parse({
    profile_id: first.profile_id,
    profile_type: first.profile_type,
    rights_status: first.rights_status,
    status: documents.length < 8 ? 'insufficient_samples' : 'ready',
    platforms: [...new Set(documents.map(({ platform }) => platform))].sort(),
    content_types: [...new Set(documents.map(({ content_type }) => content_type))].sort(),
    sample_count: documents.length,
    corpus_hash: corpusHash,
    quantitative_features: metrics,
    ...qualitative,
    forbidden_transfer: forbidden,
    created_at: options.createdAt ?? new Date().toISOString(),
    version: options.version ?? 1,
  });
  return { profile, model_calls: modelCalls };
}
