import { describe, expect, it } from 'vitest';
import {
  contentFitProfileSchema,
  validateContentMix,
  validateProductContentFitReferences,
} from '../src/product/content-fit-profile.js';
import { loadContentFitProfile } from '../src/product/load-content-fit-profile.js';
import { loadProductProfile } from '../src/product/load-product-profile.js';
import {
  getAllowedCtaModes,
  getMaximumProductFitScore,
} from '../src/product/product-claims.js';

describe('content fit profile', () => {
  it('loads config/content-fit.yaml as a strategy hypothesis', async () => {
    await expect(loadContentFitProfile()).resolves.toMatchObject({
      version: 2,
      status: 'strategy_hypothesis',
    });
  });

  it('defines all eight learner stages and content pillars', async () => {
    const profile = await loadContentFitProfile();
    expect(profile.learner_stages).toHaveLength(8);
    expect(profile.content_pillars).toHaveLength(8);
  });

  it('references only existing product modules', async () => {
    const [product, contentFit] = await Promise.all([loadProductProfile(), loadContentFitProfile()]);
    expect(() => validateProductContentFitReferences(product, contentFit)).not.toThrow();
  });

  it('rejects a missing product module reference', async () => {
    const [product, contentFit] = await Promise.all([loadProductProfile(), loadContentFitProfile()]);
    const invalid = structuredClone(contentFit);
    invalid.content_pillars[0]?.product_module_ids.push('missing_module');
    expect(() => validateProductContentFitReferences(product, invalid)).toThrow('missing_module');
  });

  it('keeps a direction-only module from inheriting a delivered pillar score', async () => {
    const [product, contentFit] = await Promise.all([loadProductProfile(), loadContentFitProfile()]);
    const invalid = structuredClone(contentFit);
    const video = invalid.content_pillars.find(({ id }) => id === 'ai_video_production');
    if (video === undefined) throw new Error('Missing AI video pillar fixture');
    video.delivery_support_status = 'confirmed_delivered';
    video.maximum_product_fit_score = 10;
    expect(() => validateProductContentFitReferences(product, invalid)).toThrow('referenced module cap 3');
  });

  it('allows light and club CTA for confirmed delivered modules', async () => {
    await expect(getAllowedCtaModes('learning_path')).resolves.toEqual(['none', 'light', 'club']);
  });

  it('allows club CTA for directly related confirmed partial modules', async () => {
    await expect(getAllowedCtaModes('real_case_library')).resolves.toContain('club');
  });

  it('never allows club CTA for direction-only modules', async () => {
    await expect(getAllowedCtaModes('ai_video_production')).resolves.toEqual(['none', 'light']);
  });

  it('fails closed for an unknown product module', async () => {
    await expect(getMaximumProductFitScore('missing_module')).resolves.toBe(0);
    await expect(getAllowedCtaModes('missing_module')).resolves.toEqual(['none']);
  });

  it('uses product manager thinking as an editorial lens, not a pillar', async () => {
    const profile = await loadContentFitProfile();
    expect(profile.editorial_lens.status).toBe('applies_to_all_content');
    expect(profile.editorial_lens.steps).toContain('建立判断标准。');
    expect(profile.content_pillars.map(({ id }) => id)).not.toContain('product_manager_perspective');
  });

  it('keeps only WeChat, X, and WeChat visuals in active content scope', async () => {
    const profile = await loadContentFitProfile();
    expect(profile.platform_scope.active_content_outputs).toEqual([
      'wechat_official_account', 'x', 'wechat_visuals',
    ]);
    expect(profile.platform_scope.active_content_outputs).not.toContain('xiaohongshu');
    expect(profile.platform_scope.retired_content_outputs).toEqual(['xiaohongshu']);
  });

  it('fixes the delivery status product-fit caps', async () => {
    expect((await loadContentFitProfile()).fit_rules.delivery_status_score_caps).toEqual({
      confirmed_delivered: 10,
      confirmed_partial: 7,
      confirmed_container: 5,
      direction_confirmed_delivery_unverified: 3,
      unknown: 0,
    });
  });

  it('rejects a direction-only pillar score above 3', async () => {
    const profile = await loadContentFitProfile();
    const invalid = structuredClone(profile);
    const video = invalid.content_pillars.find(({ id }) => id === 'ai_video_production');
    if (video === undefined) throw new Error('Missing AI video pillar fixture');
    video.maximum_product_fit_score = 4;
    expect(contentFitProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects an unknown pillar score above 0', async () => {
    const profile = await loadContentFitProfile();
    const invalid = structuredClone(profile);
    const video = invalid.content_pillars.find(({ id }) => id === 'ai_video_production');
    if (video === undefined) throw new Error('Missing AI video pillar fixture');
    video.delivery_support_status = 'unknown';
    video.maximum_product_fit_score = 1;
    expect(contentFitProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts a complete content mix and rejects a total other than 1', async () => {
    const profile = await loadContentFitProfile();
    const weights = Object.fromEntries(profile.content_pillars.map(({ id }) => [id, 0.125]));
    expect(() => validateContentMix(weights, profile)).not.toThrow();
    weights.orientation_and_selection = 0.2;
    expect(() => validateContentMix(weights, profile)).toThrow('sum to 1');
  });
});
