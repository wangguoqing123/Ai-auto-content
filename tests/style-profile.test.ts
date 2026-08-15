import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { distillStyleProfile } from '../src/style-intelligence/distill.js';
import { buildStyleFixtureDocuments, FixtureStyleProvider } from '../src/style-intelligence/fixture.js';
import { StyleProviderOutputError, type StyleDistillInput, type StyleDistillProvider } from '../src/style-intelligence/provider.js';
import { requiredPublicReferenceForbiddenTransfers, styleProfileSchema, type StyleQualitative } from '../src/style-intelligence/schemas.js';

async function fixtureQualitative(input: StyleDistillInput): Promise<StyleQualitative> {
  return new FixtureStyleProvider().distill(input);
}

describe('Style Profile distillation', () => {
  it('keeps a reference Profile with fewer than 8 samples insufficient and makes no provider call', async () => {
    const provider = new FixtureStyleProvider();
    const result = await distillStyleProfile({ documents: buildStyleFixtureDocuments({ count: 7, profileId: 'small-reference', profileType: 'reference_technique', rightsStatus: 'public_reference' }), provider });
    expect(result.profile).toMatchObject({ status: 'insufficient_samples', sample_count: 7 });
    expect(result.model_calls).toBe(0);
    expect(provider.distillCalls).toBe(0);
  });

  it('applies different owner and public-reference retention rules', async () => {
    const owner = await distillStyleProfile({ documents: buildStyleFixtureDocuments(), provider: new FixtureStyleProvider(), createdAt: '2026-08-15T00:00:00.000Z' });
    const reference = await distillStyleProfile({ documents: buildStyleFixtureDocuments({ profileId: 'fixture-reference', profileType: 'reference_technique', rightsStatus: 'public_reference' }), provider: new FixtureStyleProvider(), createdAt: '2026-08-15T00:00:00.000Z' });
    expect(owner.profile.preferred_terms).toContain('实测');
    expect(reference.profile.preferred_terms).toEqual([]);
    expect(reference.profile.forbidden_transfer).toEqual(requiredPublicReferenceForbiddenTransfers);
  });

  it('removes source sentences and personal experiences from public-reference output', async () => {
    const documents = buildStyleFixtureDocuments({ profileId: 'sanitized-reference', profileType: 'reference_technique', rightsStatus: 'public_reference' });
    const sourceSentence = documents[0]!.text;
    const provider: StyleDistillProvider = {
      providerName: 'fixture',
      async distill(input) {
        const base = await fixtureQualitative(input);
        return { ...base, voice_signals: [sourceSentence, '我在 2025年带过一名学员', ...base.voice_signals], preferred_terms: ['某作者口头禅'] };
      },
      async repair(input) { return fixtureQualitative(input); },
    };
    const result = await distillStyleProfile({ documents, provider });
    expect(result.profile.voice_signals).not.toContain(sourceSentence);
    expect(result.profile.voice_signals.join('\n')).not.toMatch(/2025年|学员/u);
    expect(result.profile.preferred_terms).toEqual([]);
  });

  it('keeps factual claims out of the strict Profile schema', async () => {
    const { profile } = await distillStyleProfile({ documents: buildStyleFixtureDocuments(), provider: new FixtureStyleProvider() });
    expect(styleProfileSchema.safeParse({ ...profile, factual_claims: ['invented'] }).success).toBe(false);
  });

  it('computes all required deterministic quantitative features without scoring humanness', async () => {
    const { profile } = await distillStyleProfile({ documents: buildStyleFixtureDocuments(), provider: new FixtureStyleProvider() });
    expect(Object.keys(profile.quantitative_features)).toEqual(expect.arrayContaining([
      'sample_count', 'chinese_char_count', 'sentence_length_p10', 'sentence_length_p50', 'sentence_length_p90',
      'sentence_length_cv', 'paragraph_length_p10', 'paragraph_length_p50', 'paragraph_length_p90',
      'one_sentence_paragraph_ratio', 'first_person_ratio', 'question_ratio', 'exclamation_ratio',
      'conjunction_density', 'abstract_noun_density', 'action_verb_density', 'numerical_detail_density',
      'example_density', 'evidence_distance', 'heading_density', 'list_density', 'opening_type_distribution',
      'ending_type_distribution', 'cta_position_distribution', 'title_length_distribution',
    ]));
    expect(profile).not.toHaveProperty('human_score');
  });

  it('uses at most Distill and one Repair call for invalid structured output', async () => {
    const fixture = new FixtureStyleProvider();
    const provider: StyleDistillProvider = {
      providerName: 'fixture',
      async distill() { throw new StyleProviderOutputError(); },
      async repair(input) { return fixture.repair(input, []); },
    };
    const result = await distillStyleProfile({ documents: buildStyleFixtureDocuments(), provider });
    expect(result.model_calls).toBe(2);
    expect(result.profile.status).toBe('ready');
  });

  it('keeps the three result categories separate', async () => {
    const { profile } = await distillStyleProfile({ documents: buildStyleFixtureDocuments(), provider: new FixtureStyleProvider() });
    expect(profile.content_pattern_profile).toHaveProperty('topic_entries');
    expect(profile.language_style_profile).toHaveProperty('rhythm_observations');
    expect(profile.conversion_pattern_profile).toHaveProperty('cta_positions');
  });

  it('exports public-reference and sample gates to the committed Draft 2020-12 Schema', async () => {
    const { profile } = await distillStyleProfile({ documents: buildStyleFixtureDocuments({ profileId: 'schema-reference', profileType: 'reference_technique', rightsStatus: 'public_reference' }), provider: new FixtureStyleProvider() });
    const schema = JSON.parse(await readFile(path.join(process.cwd(), 'schemas/style-profile.schema.json'), 'utf8')) as object;
    const validate = new Ajv2020({ strict: true, formats: { 'date-time': true } }).compile(schema);
    expect(validate(profile)).toBe(true);
    expect(validate({ ...profile, preferred_terms: ['signature term'] })).toBe(false);
    expect(validate({ ...profile, sample_count: 7, quantitative_features: { ...profile.quantitative_features, sample_count: 7 } })).toBe(false);
  });
});
