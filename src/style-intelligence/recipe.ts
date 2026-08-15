import { structureForArticleType } from './dynamic-structure.js';
import { sha256, stableJson } from './hash.js';
import {
  requiredPublicReferenceForbiddenTransfers,
  styleRecipeSchema,
  type ArticleType,
  type SelectedStyleRule,
  type StyleProfile,
  type StyleRecipe,
} from './schemas.js';

type RuleCategory = SelectedStyleRule['category'];
type SourceRole = SelectedStyleRule['source_role'];

interface CandidateSource {
  sourceRole: SourceRole;
  profileId: string | null;
  weight: number;
  candidates: Array<{ category: RuleCategory; text: string }>;
}

const categoryOrder: RuleCategory[] = ['voice', 'structure', 'explanation', 'cta', 'positive_constraint'];
const SELECTION_BUDGET = 12;

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function roundRobinCategories(values: Partial<Record<RuleCategory, readonly string[]>>): Array<{ category: RuleCategory; text: string }> {
  const normalized = Object.fromEntries(categoryOrder.map((category) => [category, unique(values[category] ?? [])])) as Record<RuleCategory, string[]>;
  const maximum = Math.max(0, ...categoryOrder.map((category) => normalized[category].length));
  const output: Array<{ category: RuleCategory; text: string }> = [];
  for (let index = 0; index < maximum; index += 1) {
    for (const category of categoryOrder) {
      const text = normalized[category][index];
      if (text !== undefined) output.push({ category, text });
    }
  }
  return output;
}

function profileCandidates(profile: StyleProfile, sourceRole: 'owner' | 'reference' | 'platform'): Array<{ category: RuleCategory; text: string }> {
  if (sourceRole === 'owner') return roundRobinCategories({
    voice: profile.voice_signals,
    structure: profile.structural_patterns,
    explanation: [...profile.explanation_patterns, ...profile.evidence_patterns],
    cta: profile.cta_patterns,
    positive_constraint: profile.positive_rules,
  });
  if (sourceRole === 'reference') return roundRobinCategories({
    structure: profile.structural_patterns,
    explanation: [...profile.explanation_patterns, ...profile.evidence_patterns],
    cta: profile.cta_patterns,
  });
  return roundRobinCategories({
    structure: [...profile.structural_patterns, ...profile.positive_rules],
    cta: profile.cta_patterns,
  });
}

function baselineCandidates(articleType: ArticleType): Array<{ category: RuleCategory; text: string }> {
  const structure = structureForArticleType(articleType);
  return roundRobinCategories({
    structure: [`Use ${articleType} sections: ${structure.sections.join(', ')}`],
    positive_constraint: ['Use the editorial voice baseline', 'Apply human-writing positive rules without claiming a learned owner voice'],
  });
}

function sourceQuota(weight: number, available: number): number {
  if (weight <= 0 || available === 0) return 0;
  return Math.min(available, Math.max(1, Math.round(weight * SELECTION_BUDGET)));
}

function selectWeightedRules(sources: CandidateSource[], articleType: ArticleType): SelectedStyleRule[] {
  const prepared = sources.map((source) => ({
    ...source,
    selected: source.candidates.slice(0, sourceQuota(source.weight, source.candidates.length)),
    cursor: 0,
  }));
  const output: SelectedStyleRule[] = [];
  while (prepared.some(({ cursor, selected }) => cursor < selected.length)) {
    const source = prepared
      .filter(({ cursor, selected }) => cursor < selected.length)
      .sort((left, right) => {
        const score = (left.cursor + 1) / left.weight - (right.cursor + 1) / right.weight;
        if (Math.abs(score) > 1e-12) return score;
        const roleOrder = ['owner', 'baseline', 'reference', 'platform'];
        const role = roleOrder.indexOf(left.sourceRole) - roleOrder.indexOf(right.sourceRole);
        if (role !== 0) return role;
        return (left.profileId ?? '').localeCompare(right.profileId ?? '');
      })[0]!;
    const candidate = source.selected[source.cursor]!;
    source.cursor += 1;
    output.push({
      rule_id: `rule_${sha256(stableJson({ category: candidate.category, text: candidate.text, source_role: source.sourceRole, source_profile_id: source.profileId })).slice(0, 16)}`,
      category: candidate.category,
      text: candidate.text,
      source_role: source.sourceRole,
      source_profile_id: source.profileId,
      source_weight: source.weight,
      selection_reason: `deterministic weighted quota for ${articleType}; source quota ${source.selected.length}; source position ${source.cursor}`,
    });
  }
  return output;
}

export interface BuildStyleRecipeOptions {
  articleType: ArticleType;
  ownerProfile?: StyleProfile;
  referenceProfiles?: StyleProfile[];
  platformProfile?: StyleProfile;
  referenceWeights?: number[];
  platformWeight?: number;
  fixtureMode?: boolean;
}

export function buildStyleRecipe(options: BuildStyleRecipeOptions): StyleRecipe {
  const owner = options.ownerProfile;
  if (owner !== undefined && (owner.status !== 'ready' || owner.profile_type !== 'owner_voice')) throw new Error('owner_profile_not_ready');
  if (options.platformProfile !== undefined && (options.platformProfile.status !== 'ready' || options.platformProfile.profile_type !== 'platform_convention')) throw new Error('platform_profile_not_ready');
  if (owner === undefined && (options.referenceProfiles?.length ?? 0) > 0) throw new Error('ownerless_recipe_cannot_use_references');
  if ((options.referenceProfiles?.length ?? 0) > 2) throw new Error('at_most_two_reference_profiles');
  const references = options.referenceProfiles ?? [];
  for (const reference of references) {
    if (reference.status !== 'ready' || reference.profile_type !== 'reference_technique' || reference.sample_count < 8) throw new Error('reference_profile_not_ready');
    if (reference.rights_status === 'public_reference' && reference.protected_index_status !== 'ready' && options.fixtureMode !== true) throw new Error('reference_protected_index_required');
  }
  const requestedWeights = options.referenceWeights ?? references.map(() => references.length === 1 ? 0.2 : 0.15);
  if (requestedWeights.length !== references.length) throw new Error('reference_weight_count_mismatch');
  const referenceTotal = requestedWeights.reduce((sum, weight) => sum + weight, 0);
  if (requestedWeights.some((weight) => weight <= 0 || weight > 0.2) || referenceTotal > 0.3 + 1e-9) throw new Error('reference_weight_limit_exceeded');
  const platformWeight = options.platformProfile === undefined ? 0 : (options.platformWeight ?? 0.1);
  if (platformWeight <= 0 && options.platformProfile !== undefined) throw new Error('platform_weight_must_be_positive');
  if (platformWeight > 0.15) throw new Error('platform_weight_limit_exceeded');
  const ownerWeight = owner === undefined ? 0 : 1 - referenceTotal - platformWeight;
  const baselineWeight = owner === undefined ? 1 - platformWeight : 0;
  if (owner !== undefined && ownerWeight < 0.6 - 1e-9) throw new Error('owner_weight_below_minimum');

  const sources: CandidateSource[] = owner === undefined
    ? [{ sourceRole: 'baseline', profileId: null, weight: baselineWeight, candidates: baselineCandidates(options.articleType) }]
    : [{ sourceRole: 'owner', profileId: owner.profile_id, weight: ownerWeight, candidates: profileCandidates(owner, 'owner') }];
  references.forEach((reference, index) => sources.push({ sourceRole: 'reference', profileId: reference.profile_id, weight: requestedWeights[index]!, candidates: profileCandidates(reference, 'reference') }));
  if (options.platformProfile !== undefined) sources.push({ sourceRole: 'platform', profileId: options.platformProfile.profile_id, weight: platformWeight, candidates: profileCandidates(options.platformProfile, 'platform') });
  const selectedRules = selectWeightedRules(sources, options.articleType);
  for (const source of sources.filter(({ sourceRole, weight, candidates }) => ['reference', 'platform'].includes(sourceRole) && weight > 0 && candidates.length > 0)) {
    if (!selectedRules.some(({ source_role, source_profile_id }) => source_role === source.sourceRole && source_profile_id === source.profileId)) throw new Error(`weighted_source_not_selected:${source.profileId}`);
  }
  if (owner !== undefined && selectedRules.filter(({ source_role }) => source_role === 'owner').length <= selectedRules.filter(({ source_role }) => source_role !== 'owner').length) throw new Error('owner_rules_not_primary');
  const body = {
    primary_owner_profile: owner?.profile_id ?? null,
    reference_profiles: references.map(({ profile_id }) => profile_id),
    platform_profile: options.platformProfile?.profile_id ?? null,
    fallback_mode: owner === undefined ? 'editorial_voice_human_writing' as const : 'owner_profile' as const,
    claims_owner_voice_learned: owner !== undefined,
    article_type: options.articleType,
    selected_rules: selectedRules,
    selected_voice_signals: selectedRules.filter(({ category }) => category === 'voice').map(({ text }) => text),
    selected_structural_patterns: selectedRules.filter(({ category }) => category === 'structure').map(({ text }) => text),
    selected_explanation_patterns: selectedRules.filter(({ category }) => category === 'explanation').map(({ text }) => text),
    selected_cta_patterns: selectedRules.filter(({ category }) => category === 'cta').map(({ text }) => text),
    positive_constraints: selectedRules.filter(({ category }) => category === 'positive_constraint').map(({ text }) => text),
    forbidden_transfers: references.length === 0 ? ['factual_claim'] as const : [...requiredPublicReferenceForbiddenTransfers],
    source_weights: {
      baseline: baselineWeight,
      owner: ownerWeight,
      references: references.map(({ profile_id }, index) => ({ profile_id, weight: requestedWeights[index]! })),
      platform: platformWeight,
    },
  };
  return styleRecipeSchema.parse({ ...body, recipe_hash: sha256(stableJson(body)) });
}
