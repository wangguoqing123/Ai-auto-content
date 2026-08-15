import { structureForArticleType } from './dynamic-structure.js';
import { sha256, stableJson } from './hash.js';
import { requiredPublicReferenceForbiddenTransfers, styleRecipeSchema, type ArticleType, type StyleProfile, type StyleRecipe } from './schemas.js';

function selected(values: readonly string[], maximum = 3): string[] {
  return [...new Set(values)].slice(0, maximum);
}

export interface BuildStyleRecipeOptions {
  articleType: ArticleType;
  ownerProfile?: StyleProfile;
  referenceProfiles?: StyleProfile[];
  platformProfile?: StyleProfile;
  referenceWeights?: number[];
  platformWeight?: number;
}

export function buildStyleRecipe(options: BuildStyleRecipeOptions): StyleRecipe {
  const owner = options.ownerProfile;
  if (owner !== undefined && (owner.status !== 'ready' || owner.profile_type !== 'owner_voice')) throw new Error('owner_profile_not_ready');
  if (options.platformProfile !== undefined && (options.platformProfile.status !== 'ready' || options.platformProfile.profile_type !== 'platform_convention')) {
    throw new Error('platform_profile_not_ready');
  }
  const references = owner === undefined ? [] : (options.referenceProfiles ?? []).slice(0, 2);
  for (const reference of references) {
    if (reference.status !== 'ready' || reference.profile_type !== 'reference_technique' || reference.sample_count < 8) throw new Error('reference_profile_not_ready');
  }
  if ((options.referenceProfiles?.length ?? 0) > 2) throw new Error('at_most_two_reference_profiles');
  const requestedWeights = options.referenceWeights ?? references.map(() => references.length === 1 ? 0.2 : 0.15);
  if (requestedWeights.length !== references.length) throw new Error('reference_weight_count_mismatch');
  if (requestedWeights.some((weight) => weight > 0.2) || requestedWeights.reduce((sum, weight) => sum + weight, 0) > 0.3 + Number.EPSILON) {
    throw new Error('reference_weight_limit_exceeded');
  }
  const platformWeight = options.platformProfile === undefined ? 0 : (options.platformWeight ?? 0.1);
  if (platformWeight > 0.15) throw new Error('platform_weight_limit_exceeded');
  const sourceProfiles = owner === undefined ? [] : [owner, ...references];
  const structure = structureForArticleType(options.articleType);
  const body = {
    primary_owner_profile: owner?.profile_id ?? null,
    reference_profiles: references.map(({ profile_id }) => profile_id),
    platform_profile: options.platformProfile?.profile_id ?? null,
    fallback_mode: owner === undefined ? 'editorial_voice_human_writing' as const : 'owner_profile' as const,
    claims_owner_voice_learned: owner !== undefined,
    article_type: options.articleType,
    selected_voice_signals: selected(sourceProfiles.flatMap(({ voice_signals }) => voice_signals)),
    selected_structural_patterns: selected([
      `Use ${options.articleType} sections: ${structure.sections.join(', ')}`,
      ...sourceProfiles.flatMap(({ structural_patterns }) => structural_patterns),
    ]),
    selected_explanation_patterns: selected(sourceProfiles.flatMap(({ explanation_patterns }) => explanation_patterns)),
    selected_cta_patterns: selected(sourceProfiles.flatMap(({ cta_patterns }) => cta_patterns)),
    positive_constraints: owner === undefined
      ? ['Use the editorial voice baseline', 'Apply human-writing positive rules without claiming a learned owner voice']
      : selected([...(owner.positive_rules), ...references.flatMap(({ positive_rules }) => positive_rules)], 6),
    forbidden_transfers: references.length === 0 ? ['factual_claim'] as const : [...requiredPublicReferenceForbiddenTransfers],
    source_weights: {
      owner: owner === undefined ? 0 : 0.6,
      references: references.map(({ profile_id }, index) => ({ profile_id, weight: requestedWeights[index]! })),
      platform: platformWeight,
    },
  };
  return styleRecipeSchema.parse({ ...body, recipe_hash: sha256(stableJson(body)) });
}
