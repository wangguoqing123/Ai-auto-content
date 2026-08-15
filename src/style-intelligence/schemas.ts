import { z } from 'zod';

const boundedText = (maximum = 1_000) => z.string().trim().min(1).max(maximum);
const stringList = (maximum = 30) => z.array(boundedText()).max(maximum);
const distributionSchema = z.record(z.string(), z.number().nonnegative());

export const profileTypeSchema = z.enum(['owner_voice', 'reference_technique', 'platform_convention']);
export const rightsStatusSchema = z.enum(['owned_by_user', 'licensed', 'public_reference']);
export const articleTypeSchema = z.enum(['tutorial', 'analysis', 'case_breakdown', 'opinion', 'checklist']);
export const rightsBasisSchema = z.enum(['user_owned', 'explicit_license', 'public_reference_analysis']);
export const modelProviderScopeSchema = z.enum(['codex_cli', 'none']);

export const corpusSourceSchema = z.strictObject({
  creator_id: boundedText(300),
  creator_display_name: boundedText(500),
  canonical_url: z.url().nullable(),
  platform_item_id: boundedText(500),
  published_at: z.iso.datetime(),
  source_filename: boundedText(500),
});

export const corpusRightsSchema = z.strictObject({
  basis: rightsBasisSchema,
  permission_reference: boundedText(2_000),
  confirmed_at: z.iso.datetime(),
});

export const corpusModelProcessingSchema = z.strictObject({
  allowed: z.boolean(),
  provider_scope: modelProviderScopeSchema,
  consent_recorded_at: z.iso.datetime(),
}).superRefine((value, context) => {
  if (value.allowed !== (value.provider_scope === 'codex_cli')) {
    context.addIssue({ code: 'custom', path: ['provider_scope'], message: 'Allowed model processing requires codex_cli; denied processing requires none' });
  }
});

export const corpusDocumentSchema = z.strictObject({
  document_id: z.string().regex(/^doc_[a-f0-9]{16}$/),
  profile_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,100}$/),
  profile_type: profileTypeSchema,
  rights_status: rightsStatusSchema,
  platform: boundedText(100),
  content_type: boundedText(100),
  title: boundedText(1_000),
  text: boundedText(2_000_000),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  source: corpusSourceSchema,
  rights: corpusRightsSchema,
  model_processing: corpusModelProcessingSchema,
  imported_at: z.iso.datetime(),
}).superRefine((document, context) => {
  const expectedBasis = document.rights_status === 'owned_by_user' ? 'user_owned'
    : document.rights_status === 'licensed' ? 'explicit_license' : 'public_reference_analysis';
  if (document.rights.basis !== expectedBasis) {
    context.addIssue({ code: 'custom', path: ['rights', 'basis'], message: `Rights basis must be ${expectedBasis}` });
  }
  if (document.rights_status === 'public_reference' && document.profile_type !== 'reference_technique') {
    context.addIssue({ code: 'custom', path: ['profile_type'], message: 'Public references can only produce reference techniques' });
  }
  if (document.rights_status === 'public_reference' && document.source.canonical_url === null) {
    context.addIssue({ code: 'custom', path: ['source', 'canonical_url'], message: 'Public references require a canonical URL' });
  }
});

export const modelInputDocumentCoverageSchema = z.strictObject({
  document_id: z.string().regex(/^doc_[a-f0-9]{16}$/),
  original_chars: z.number().int().nonnegative(),
  supplied_chars: z.number().int().nonnegative(),
  coverage_ratio: z.number().min(0).max(1),
  truncation_applied: z.boolean(),
});

export const modelInputCoverageSchema = z.strictObject({
  maximum_documents: z.literal(30),
  maximum_chars_per_document: z.literal(12_000),
  maximum_total_chars: z.literal(240_000),
  original_documents: z.number().int().nonnegative(),
  selected_documents: z.number().int().nonnegative().max(30),
  original_chars: z.number().int().nonnegative(),
  supplied_chars: z.number().int().nonnegative().max(240_000),
  coverage_ratio: z.number().min(0).max(1),
  truncation_applied: z.boolean(),
  per_document: z.array(modelInputDocumentCoverageSchema).max(10_000),
});

export const quantitativeFeaturesSchema = z.strictObject({
  sample_count: z.number().int().nonnegative(),
  chinese_char_count: z.number().int().nonnegative(),
  sentence_length_p10: z.number().nonnegative(),
  sentence_length_p50: z.number().nonnegative(),
  sentence_length_p90: z.number().nonnegative(),
  sentence_length_cv: z.number().nonnegative(),
  paragraph_length_p10: z.number().nonnegative(),
  paragraph_length_p50: z.number().nonnegative(),
  paragraph_length_p90: z.number().nonnegative(),
  one_sentence_paragraph_ratio: z.number().min(0).max(1),
  first_person_ratio: z.number().nonnegative(),
  question_ratio: z.number().min(0).max(1),
  exclamation_ratio: z.number().min(0).max(1),
  conjunction_density: z.number().nonnegative(),
  abstract_noun_density: z.number().nonnegative(),
  action_verb_density: z.number().nonnegative(),
  numerical_detail_density: z.number().nonnegative(),
  example_density: z.number().nonnegative(),
  evidence_distance: z.number().nonnegative(),
  heading_density: z.number().nonnegative(),
  list_density: z.number().nonnegative(),
  opening_type_distribution: distributionSchema,
  ending_type_distribution: distributionSchema,
  cta_position_distribution: distributionSchema,
  title_length_distribution: distributionSchema,
});

export const contentPatternProfileSchema = z.strictObject({
  topic_entries: stringList(),
  problem_definitions: stringList(),
  evidence_placement: stringList(),
  progression_patterns: stringList(),
  ending_patterns: stringList(),
});

export const languageStyleProfileSchema = z.strictObject({
  rhythm_observations: stringList(),
  first_person_usage: stringList(),
  question_usage: stringList(),
  transition_patterns: stringList(),
  abstraction_and_action: stringList(),
  judgment_and_uncertainty: stringList(),
  humor_and_asides: stringList(),
});

export const conversionPatternProfileSchema = z.strictObject({
  cta_positions: stringList(),
  cta_length_patterns: stringList(),
  free_value_completeness: stringList(),
  product_connections: stringList(),
  anxiety_patterns: stringList(),
  omitted_step_patterns: stringList(),
});

export const requiredPublicReferenceForbiddenTransfers = [
  'personal_experience',
  'personal_identity',
  'signature_phrase',
  'unique_metaphor',
  'factual_claim',
  'client_or_student_story',
] as const;

export const selectedStyleRuleCategorySchema = z.enum(['voice', 'structure', 'explanation', 'cta', 'positive_constraint']);
export const selectedStyleRuleSourceRoleSchema = z.enum(['baseline', 'owner', 'reference', 'platform']);
export const selectedStyleRuleSchema = z.strictObject({
  rule_id: z.string().regex(/^rule_[a-f0-9]{16}$/),
  category: selectedStyleRuleCategorySchema,
  text: boundedText(2_000),
  source_role: selectedStyleRuleSourceRoleSchema,
  source_profile_id: z.string().nullable(),
  source_weight: z.number().min(0).max(1),
  selection_reason: boundedText(1_000),
}).superRefine((rule, context) => {
  if ((rule.source_role === 'baseline') !== (rule.source_profile_id === null)) {
    context.addIssue({ code: 'custom', path: ['source_profile_id'], message: 'Only baseline rules can omit a Profile ID' });
  }
  if (rule.source_role === 'reference' && (rule.category === 'voice' || rule.category === 'positive_constraint')) {
    context.addIssue({ code: 'custom', path: ['category'], message: 'Reference Profiles cannot provide voice or preferred constraints' });
  }
  if (rule.source_role === 'platform' && !['structure', 'cta'].includes(rule.category)) {
    context.addIssue({ code: 'custom', path: ['category'], message: 'Platform Profiles can only provide organization, format, reading, or CTA rules' });
  }
});

export const styleQualitativeSchema = z.strictObject({
  voice_signals: stringList(),
  structural_patterns: stringList(),
  explanation_patterns: stringList(),
  evidence_patterns: stringList(),
  cta_patterns: stringList(),
  positive_rules: stringList(),
  anti_patterns: stringList(),
  preferred_terms: stringList(),
  content_pattern_profile: contentPatternProfileSchema,
  language_style_profile: languageStyleProfileSchema,
  conversion_pattern_profile: conversionPatternProfileSchema,
  confidence: z.number().min(0).max(1),
});

export const styleProfileSchema = z.strictObject({
  profile_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,100}$/),
  profile_type: profileTypeSchema,
  rights_status: rightsStatusSchema,
  status: z.enum(['ready', 'insufficient_samples', 'processing_not_allowed']),
  platforms: z.array(boundedText(100)).max(10),
  content_types: z.array(boundedText(100)).max(10),
  sample_count: z.number().int().nonnegative(),
  corpus_hash: z.string().regex(/^[a-f0-9]{64}$/),
  model_input_hash: z.string().regex(/^[a-f0-9]{64}$/),
  input_coverage: modelInputCoverageSchema,
  protected_index_status: z.enum(['not_required', 'ready', 'missing']),
  quantitative_features: quantitativeFeaturesSchema,
  voice_signals: stringList(),
  structural_patterns: stringList(),
  explanation_patterns: stringList(),
  evidence_patterns: stringList(),
  cta_patterns: stringList(),
  positive_rules: stringList(),
  anti_patterns: stringList(),
  preferred_terms: stringList(),
  forbidden_transfer: z.array(z.enum(requiredPublicReferenceForbiddenTransfers)).max(requiredPublicReferenceForbiddenTransfers.length),
  content_pattern_profile: contentPatternProfileSchema,
  language_style_profile: languageStyleProfileSchema,
  conversion_pattern_profile: conversionPatternProfileSchema,
  confidence: z.number().min(0).max(1),
  created_at: z.iso.datetime(),
  version: z.number().int().positive(),
}).superRefine((profile, context) => {
  if (profile.sample_count < 8 && !['insufficient_samples', 'processing_not_allowed'].includes(profile.status)) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Profiles with fewer than 8 samples must remain insufficient' });
  }
  if (profile.sample_count >= 8 && !['ready', 'processing_not_allowed'].includes(profile.status)) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Profiles with enough samples must be ready or processing_not_allowed' });
  }
  if (profile.quantitative_features.sample_count !== profile.sample_count) {
    context.addIssue({ code: 'custom', path: ['quantitative_features', 'sample_count'], message: 'Sample count must match' });
  }
  if (profile.rights_status === 'public_reference') {
    if (profile.profile_type !== 'reference_technique') {
      context.addIssue({ code: 'custom', path: ['profile_type'], message: 'Public references can only produce reference techniques' });
    }
    if (profile.preferred_terms.length > 0) {
      context.addIssue({ code: 'custom', path: ['preferred_terms'], message: 'Public-reference terms are not retained in v0' });
    }
    if (profile.voice_signals.length > 0) context.addIssue({ code: 'custom', path: ['voice_signals'], message: 'Public-reference voice signals are not retained' });
    for (const required of requiredPublicReferenceForbiddenTransfers) {
      if (!profile.forbidden_transfer.includes(required)) {
        context.addIssue({ code: 'custom', path: ['forbidden_transfer'], message: `Missing forbidden transfer: ${required}` });
      }
    }
    if (profile.protected_index_status === 'not_required') {
      context.addIssue({ code: 'custom', path: ['protected_index_status'], message: 'Public-reference Profiles require a Protected Transfer Index status' });
    }
  } else if (profile.protected_index_status !== 'not_required') {
    context.addIssue({ code: 'custom', path: ['protected_index_status'], message: 'Protected Transfer Index only applies to public-reference Profiles' });
  }
});

export const styleRecipeSchema = z.strictObject({
  primary_owner_profile: z.string().nullable(),
  reference_profiles: z.array(z.string()).max(2),
  platform_profile: z.string().nullable(),
  fallback_mode: z.enum(['owner_profile', 'editorial_voice_human_writing']),
  claims_owner_voice_learned: z.boolean(),
  article_type: articleTypeSchema,
  selected_rules: z.array(selectedStyleRuleSchema).min(1).max(30),
  selected_voice_signals: stringList(30),
  selected_structural_patterns: stringList(30),
  selected_explanation_patterns: stringList(30),
  selected_cta_patterns: stringList(30),
  positive_constraints: stringList(30),
  forbidden_transfers: z.array(z.enum(requiredPublicReferenceForbiddenTransfers)).max(requiredPublicReferenceForbiddenTransfers.length),
  source_weights: z.strictObject({
    baseline: z.number().min(0).max(1),
    owner: z.number().min(0).max(1),
    references: z.array(z.strictObject({ profile_id: z.string(), weight: z.number().min(0).max(0.2) })).max(2),
    platform: z.number().min(0).max(0.15),
  }),
  recipe_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine((recipe, context) => {
  const tolerance = 1e-9;
  const referenceTotal = recipe.source_weights.references.reduce((sum, item) => sum + item.weight, 0);
  const total = recipe.source_weights.baseline + recipe.source_weights.owner + referenceTotal + recipe.source_weights.platform;
  if (Math.abs(total - 1) > tolerance) context.addIssue({ code: 'custom', path: ['source_weights'], message: 'Source weights must sum to 1' });
  if (referenceTotal > 0.3 + tolerance) context.addIssue({ code: 'custom', path: ['source_weights', 'references'], message: 'Reference total exceeds 0.30' });
  if (new Set(recipe.reference_profiles).size !== recipe.reference_profiles.length) context.addIssue({ code: 'custom', path: ['reference_profiles'], message: 'Duplicate reference profile' });
  if (recipe.reference_profiles.join('\n') !== recipe.source_weights.references.map(({ profile_id }) => profile_id).join('\n')) {
    context.addIssue({ code: 'custom', path: ['source_weights', 'references'], message: 'Reference weights must match selected profiles' });
  }
  if (recipe.primary_owner_profile === null) {
    if (recipe.fallback_mode !== 'editorial_voice_human_writing' || recipe.claims_owner_voice_learned || recipe.source_weights.owner !== 0 || recipe.reference_profiles.length > 0 || Math.abs(recipe.source_weights.baseline - (1 - recipe.source_weights.platform)) > tolerance) {
      context.addIssue({ code: 'custom', message: 'Ownerless recipes must use the non-mimetic editorial fallback' });
    }
  } else if (recipe.fallback_mode !== 'owner_profile' || !recipe.claims_owner_voice_learned || recipe.source_weights.owner < 0.6 || recipe.source_weights.baseline !== 0 || Math.abs(recipe.source_weights.owner - (1 - referenceTotal - recipe.source_weights.platform)) > tolerance) {
    context.addIssue({ code: 'custom', path: ['source_weights', 'owner'], message: 'Owner recipes require weight >= 0.60' });
  }
  if ((recipe.platform_profile === null) !== (recipe.source_weights.platform === 0)) {
    context.addIssue({ code: 'custom', path: ['platform_profile'], message: 'Platform Profile and weight must be present together' });
  }
  const expectedConvenience = {
    selected_voice_signals: recipe.selected_rules.filter(({ category }) => category === 'voice').map(({ text }) => text),
    selected_structural_patterns: recipe.selected_rules.filter(({ category }) => category === 'structure').map(({ text }) => text),
    selected_explanation_patterns: recipe.selected_rules.filter(({ category }) => category === 'explanation').map(({ text }) => text),
    selected_cta_patterns: recipe.selected_rules.filter(({ category }) => category === 'cta').map(({ text }) => text),
    positive_constraints: recipe.selected_rules.filter(({ category }) => category === 'positive_constraint').map(({ text }) => text),
  };
  for (const [field, values] of Object.entries(expectedConvenience)) {
    if ((recipe[field as keyof typeof expectedConvenience] as string[]).join('\n') !== values.join('\n')) {
      context.addIssue({ code: 'custom', path: [field], message: 'Convenience arrays must be derived from selected_rules' });
    }
  }
  const seenRuleIds = new Set<string>();
  for (const rule of recipe.selected_rules) {
    if (seenRuleIds.has(rule.rule_id)) context.addIssue({ code: 'custom', path: ['selected_rules'], message: `Duplicate selected rule: ${rule.rule_id}` });
    seenRuleIds.add(rule.rule_id);
    const expectedWeight = rule.source_role === 'baseline' ? recipe.source_weights.baseline
      : rule.source_role === 'owner' ? recipe.source_weights.owner
        : rule.source_role === 'platform' ? recipe.source_weights.platform
          : recipe.source_weights.references.find(({ profile_id }) => profile_id === rule.source_profile_id)?.weight;
    if (expectedWeight === undefined || Math.abs(expectedWeight - rule.source_weight) > tolerance) {
      context.addIssue({ code: 'custom', path: ['selected_rules'], message: `Rule source weight mismatch: ${rule.rule_id}` });
    }
    if (rule.source_role === 'owner' && rule.source_profile_id !== recipe.primary_owner_profile) context.addIssue({ code: 'custom', path: ['selected_rules'], message: 'Owner rule Profile mismatch' });
    if (rule.source_role === 'platform' && rule.source_profile_id !== recipe.platform_profile) context.addIssue({ code: 'custom', path: ['selected_rules'], message: 'Platform rule Profile mismatch' });
  }
});

export type ProfileType = z.infer<typeof profileTypeSchema>;
export type RightsStatus = z.infer<typeof rightsStatusSchema>;
export type ArticleType = z.infer<typeof articleTypeSchema>;
export type QuantitativeFeatures = z.infer<typeof quantitativeFeaturesSchema>;
export type StyleQualitative = z.infer<typeof styleQualitativeSchema>;
export type StyleProfile = z.infer<typeof styleProfileSchema>;
export type StyleRecipe = z.infer<typeof styleRecipeSchema>;
export type SelectedStyleRule = z.infer<typeof selectedStyleRuleSchema>;
export type CorpusDocument = z.infer<typeof corpusDocumentSchema>;
export type RightsBasis = z.infer<typeof rightsBasisSchema>;
export type ModelProviderScope = z.infer<typeof modelProviderScopeSchema>;
export type ModelInputCoverage = z.infer<typeof modelInputCoverageSchema>;
