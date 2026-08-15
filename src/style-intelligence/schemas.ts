import { z } from 'zod';

const boundedText = (maximum = 1_000) => z.string().trim().min(1).max(maximum);
const stringList = (maximum = 30) => z.array(boundedText()).max(maximum);
const distributionSchema = z.record(z.string(), z.number().nonnegative());

export const profileTypeSchema = z.enum(['owner_voice', 'reference_technique', 'platform_convention']);
export const rightsStatusSchema = z.enum(['owned_by_user', 'licensed', 'public_reference']);
export const articleTypeSchema = z.enum(['tutorial', 'analysis', 'case_breakdown', 'opinion', 'checklist']);

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
  status: z.enum(['ready', 'insufficient_samples']),
  platforms: z.array(boundedText(100)).max(10),
  content_types: z.array(boundedText(100)).max(10),
  sample_count: z.number().int().nonnegative(),
  corpus_hash: z.string().regex(/^[a-f0-9]{64}$/),
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
  if ((profile.sample_count < 8) !== (profile.status === 'insufficient_samples')) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Profiles with fewer than 8 samples must remain insufficient' });
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
    for (const required of requiredPublicReferenceForbiddenTransfers) {
      if (!profile.forbidden_transfer.includes(required)) {
        context.addIssue({ code: 'custom', path: ['forbidden_transfer'], message: `Missing forbidden transfer: ${required}` });
      }
    }
  }
});

export const styleRecipeSchema = z.strictObject({
  primary_owner_profile: z.string().nullable(),
  reference_profiles: z.array(z.string()).max(2),
  platform_profile: z.string().nullable(),
  fallback_mode: z.enum(['owner_profile', 'editorial_voice_human_writing']),
  claims_owner_voice_learned: z.boolean(),
  article_type: articleTypeSchema,
  selected_voice_signals: stringList(10),
  selected_structural_patterns: stringList(10),
  selected_explanation_patterns: stringList(10),
  selected_cta_patterns: stringList(10),
  positive_constraints: stringList(20),
  forbidden_transfers: z.array(z.enum(requiredPublicReferenceForbiddenTransfers)).max(requiredPublicReferenceForbiddenTransfers.length),
  source_weights: z.strictObject({
    owner: z.number().min(0).max(1),
    references: z.array(z.strictObject({ profile_id: z.string(), weight: z.number().min(0).max(0.2) })).max(2),
    platform: z.number().min(0).max(0.15),
  }),
  recipe_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine((recipe, context) => {
  const referenceTotal = recipe.source_weights.references.reduce((sum, item) => sum + item.weight, 0);
  if (referenceTotal > 0.3 + Number.EPSILON) context.addIssue({ code: 'custom', path: ['source_weights', 'references'], message: 'Reference total exceeds 0.30' });
  if (new Set(recipe.reference_profiles).size !== recipe.reference_profiles.length) context.addIssue({ code: 'custom', path: ['reference_profiles'], message: 'Duplicate reference profile' });
  if (recipe.reference_profiles.join('\n') !== recipe.source_weights.references.map(({ profile_id }) => profile_id).join('\n')) {
    context.addIssue({ code: 'custom', path: ['source_weights', 'references'], message: 'Reference weights must match selected profiles' });
  }
  if (recipe.primary_owner_profile === null) {
    if (recipe.fallback_mode !== 'editorial_voice_human_writing' || recipe.claims_owner_voice_learned || recipe.source_weights.owner !== 0 || recipe.reference_profiles.length > 0) {
      context.addIssue({ code: 'custom', message: 'Ownerless recipes must use the non-mimetic editorial fallback' });
    }
  } else if (recipe.fallback_mode !== 'owner_profile' || !recipe.claims_owner_voice_learned || recipe.source_weights.owner < 0.6) {
    context.addIssue({ code: 'custom', path: ['source_weights', 'owner'], message: 'Owner recipes require weight >= 0.60' });
  }
});

export type ProfileType = z.infer<typeof profileTypeSchema>;
export type RightsStatus = z.infer<typeof rightsStatusSchema>;
export type ArticleType = z.infer<typeof articleTypeSchema>;
export type QuantitativeFeatures = z.infer<typeof quantitativeFeaturesSchema>;
export type StyleQualitative = z.infer<typeof styleQualitativeSchema>;
export type StyleProfile = z.infer<typeof styleProfileSchema>;
export type StyleRecipe = z.infer<typeof styleRecipeSchema>;
