import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { distillStyleProfile } from '../src/style-intelligence/distill.js';
import { structureForArticleType } from '../src/style-intelligence/dynamic-structure.js';
import { buildStyleFixtureDocuments, FixtureStyleProvider } from '../src/style-intelligence/fixture.js';
import { buildStyleRecipe } from '../src/style-intelligence/recipe.js';
import { styleRecipeSchema, type StyleProfile } from '../src/style-intelligence/schemas.js';

let owner: StyleProfile;
let firstReference: StyleProfile;
let secondReference: StyleProfile;
let thirdReference: StyleProfile;
let platform: StyleProfile;

beforeAll(async () => {
  owner = (await distillStyleProfile({ documents: buildStyleFixtureDocuments(), provider: new FixtureStyleProvider(), createdAt: '2026-08-15T00:00:00.000Z' })).profile;
  const reference = async (profileId: string) => (await distillStyleProfile({ documents: buildStyleFixtureDocuments({ profileId, profileType: 'reference_technique', rightsStatus: 'public_reference' }), provider: new FixtureStyleProvider(), createdAt: '2026-08-15T00:00:00.000Z' })).profile;
  [firstReference, secondReference, thirdReference] = await Promise.all([reference('reference-one'), reference('reference-two'), reference('reference-three')]);
  platform = (await distillStyleProfile({ documents: buildStyleFixtureDocuments({ profileId: 'platform-wechat', profileType: 'platform_convention', rightsStatus: 'licensed' }), provider: new FixtureStyleProvider(), createdAt: '2026-08-15T00:00:00.000Z' })).profile;
});

describe('Style Recipe', () => {
  it('enforces owner >= 0.60, references <= 0.30 total, each <= 0.20, and at most two', () => {
    const recipe = buildStyleRecipe({ articleType: 'analysis', ownerProfile: owner, referenceProfiles: [firstReference, secondReference], referenceWeights: [0.15, 0.15], fixtureMode: true });
    expect(recipe.source_weights.owner).toBeGreaterThanOrEqual(0.6);
    expect(recipe.source_weights.references.reduce((sum, item) => sum + item.weight, 0)).toBeLessThanOrEqual(0.3);
    expect(recipe.source_weights.references.every(({ weight }) => weight <= 0.2)).toBe(true);
    expect(recipe.source_weights.baseline + recipe.source_weights.owner + recipe.source_weights.platform + recipe.source_weights.references.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1, 12);
    expect(() => buildStyleRecipe({ articleType: 'analysis', ownerProfile: owner, referenceProfiles: [firstReference, secondReference, thirdReference], fixtureMode: true })).toThrow('at_most_two_reference_profiles');
    expect(() => buildStyleRecipe({ articleType: 'analysis', ownerProfile: owner, referenceProfiles: [firstReference], referenceWeights: [0.21], fixtureMode: true })).toThrow('reference_weight_limit_exceeded');
    expect(styleRecipeSchema.safeParse({ ...recipe, source_weights: { ...recipe.source_weights, owner: 0.59 } }).success).toBe(false);
  });

  it('is stable and reproducible for the same selected inputs', () => {
    const options = { articleType: 'tutorial' as const, ownerProfile: owner, referenceProfiles: [firstReference], referenceWeights: [0.2], fixtureMode: true };
    expect(buildStyleRecipe(options)).toEqual(buildStyleRecipe(options));
  });

  it('uses editorial voice plus human-writing when no owner Profile exists', () => {
    const recipe = buildStyleRecipe({ articleType: 'opinion' });
    expect(recipe).toMatchObject({ primary_owner_profile: null, fallback_mode: 'editorial_voice_human_writing', claims_owner_voice_learned: false, reference_profiles: [] });
  });

  it('lets platform rules participate with baseline but never as voice', () => {
    const uniquePlatform = { ...platform, structural_patterns: ['微信平台唯一段落组织规则'], voice_signals: ['不得进入的人物声音'], cta_patterns: [] };
    const recipe = buildStyleRecipe({ articleType: 'opinion', platformProfile: uniquePlatform, platformWeight: 0.15 });
    expect(recipe.selected_rules).toContainEqual(expect.objectContaining({ text: '微信平台唯一段落组织规则', source_role: 'platform', source_profile_id: 'platform-wechat' }));
    expect(recipe.selected_rules.filter(({ source_role }) => source_role === 'platform').every(({ category }) => category !== 'voice')).toBe(true);
    expect(recipe.source_weights).toMatchObject({ baseline: 0.85, owner: 0, platform: 0.15, references: [] });
  });

  it('selects every nonzero reference despite owner ordering and traces every selected rule', () => {
    const ownerWithTen = { ...owner, voice_signals: Array.from({ length: 10 }, (_, index) => `Owner rule ${index + 1}`), structural_patterns: [], explanation_patterns: [], evidence_patterns: [], cta_patterns: [], positive_rules: [] };
    const first = { ...firstReference, structural_patterns: ['Reference one unique'], explanation_patterns: [], evidence_patterns: [], cta_patterns: [], preferred_terms: ['must-not-transfer'] };
    const second = { ...secondReference, structural_patterns: ['Reference two unique'], explanation_patterns: [], evidence_patterns: [], cta_patterns: [] };
    const recipe = buildStyleRecipe({ articleType: 'analysis', ownerProfile: ownerWithTen, referenceProfiles: [first, second], referenceWeights: [0.1, 0.1], fixtureMode: true });
    expect(recipe.selected_rules.map(({ text }) => text)).toEqual(expect.arrayContaining(['Reference one unique', 'Reference two unique']));
    expect(recipe.selected_rules.map(({ text }) => text)).not.toContain('must-not-transfer');
    expect(recipe.selected_rules.every((rule) => rule.source_role === 'baseline' ? rule.source_profile_id === null : rule.source_profile_id !== null)).toBe(true);
    expect(recipe.selected_rules.filter(({ source_role }) => source_role === 'owner').length).toBeGreaterThan(recipe.selected_rules.filter(({ source_role }) => source_role !== 'owner').length);
  });

  it('changes deterministic selection when a Reference weight changes', () => {
    const low = buildStyleRecipe({ articleType: 'analysis', ownerProfile: owner, referenceProfiles: [firstReference], referenceWeights: [0.05], fixtureMode: true });
    const high = buildStyleRecipe({ articleType: 'analysis', ownerProfile: owner, referenceProfiles: [firstReference], referenceWeights: [0.2], fixtureMode: true });
    expect(low.selected_rules.filter(({ source_role }) => source_role === 'reference')).toHaveLength(1);
    expect(high.selected_rules.filter(({ source_role }) => source_role === 'reference').length).toBeGreaterThan(1);
    expect(low.recipe_hash).not.toBe(high.recipe_hash);
  });

  it('uses the automatically ready Protected Index for formal public-reference recipes', () => {
    expect(firstReference.protected_index_status).toBe('ready');
    expect(buildStyleRecipe({ articleType: 'analysis', ownerProfile: owner, referenceProfiles: [firstReference] }).fallback_mode).toBe('owner_profile');
  });

  it('uses a dynamic structure per article type and only forces steps for tutorial/checklist', () => {
    expect(structureForArticleType('tutorial')).toMatchObject({ requires_steps: true });
    expect(structureForArticleType('checklist')).toMatchObject({ requires_steps: true });
    expect(structureForArticleType('analysis')).toEqual({ sections: ['judgment', 'evidence', 'mechanism', 'user_impact', 'boundary', 'action'], requires_steps: false });
    expect(structureForArticleType('case_breakdown').sections).not.toEqual(structureForArticleType('opinion').sections);
  });

  it('rejects an insufficient reference Profile', async () => {
    const insufficient = (await distillStyleProfile({ documents: buildStyleFixtureDocuments({ count: 7, profileId: 'too-small', profileType: 'reference_technique', rightsStatus: 'public_reference' }) })).profile;
    expect(() => buildStyleRecipe({ articleType: 'tutorial', ownerProfile: owner, referenceProfiles: [insufficient], fixtureMode: true })).toThrow('reference_profile_not_ready');
  });

  it('exports owner and fallback gates to the committed Draft 2020-12 Schema', async () => {
    const schema = JSON.parse(await readFile(path.join(process.cwd(), 'schemas/style-recipe.schema.json'), 'utf8')) as object;
    const validate = new Ajv2020({ strict: true }).compile(schema);
    const ownerRecipe = buildStyleRecipe({ articleType: 'tutorial', ownerProfile: owner });
    expect(validate(ownerRecipe)).toBe(true);
    expect(validate({ ...ownerRecipe, source_weights: { ...ownerRecipe.source_weights, owner: 0.59 } })).toBe(false);
    const fallback = buildStyleRecipe({ articleType: 'tutorial' });
    expect(validate(fallback)).toBe(true);
    expect(validate({ ...fallback, claims_owner_voice_learned: true })).toBe(false);
  });
});
