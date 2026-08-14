import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProductProfile } from '../src/product/load-product-profile.js';
import {
  getConfirmedProductClaim,
  getMaximumProductFitScore,
  getProductModule,
  isProductClaimAllowed,
  requiresProductEvidence,
} from '../src/product/product-claims.js';

const rootDir = process.cwd();
const expectedPositioning = 'AI 不掉队俱乐部，是一个面向已经开始接触 AI、但还没有稳定用起来的人，以学习路径、基础课程、工具实操、完整项目、真实案例和社群交流，帮助用户把 AI 逐步接入内容、工作和真实业务的长期实践学习社群。';

describe('product profile facts', () => {
  it('loads config/product.yaml', async () => {
    await expect(loadProductProfile()).resolves.toMatchObject({ version: 2 });
  });

  it('uses the confirmed product name and positioning verbatim', async () => {
    const profile = await loadProductProfile();
    expect(profile.product.name).toBe('AI 不掉队俱乐部');
    expect(profile.positioning.primary).toBe(expectedPositioning);
    expect(profile.positioning.core_promise).toBe('不是追每一个新工具，而是把 AI 真正用起来。');
    expect(profile.positioning.final_goal).toBe('把 AI 稳定接入自己的内容、工作和真实业务。');
  });

  it('records every confirmed from/to transformation', async () => {
    const { positioning } = await loadProductProfile();
    expect(positioning.transformation.from).toHaveLength(6);
    expect(positioning.transformation.to).toHaveLength(6);
    expect(positioning.transformation.from).toContain('每次使用都从零开始。');
    expect(positioning.transformation.to).toContain('能把多个工具组成工作流。');
  });

  it('records exactly the four required mechanisms', async () => {
    const profile = await loadProductProfile();
    expect(profile.mechanisms.map(({ id }) => id)).toEqual([
      'membership_knowledge_base',
      'clear_learning_path',
      'real_project_practice',
      'community_exchange',
    ]);
  });

  it('records the three learning principles', async () => {
    const profile = await loadProductProfile();
    expect(profile.learning_method.principles.map(({ id }) => id)).toEqual([
      'practice_first',
      'ask_ai_first',
      'share_real_practice',
    ]);
  });

  it('requires a 2～4 week result and one path at a time', async () => {
    const profile = await loadProductProfile();
    expect(profile.learning_method.first_use_instruction).toContain('2～4 周');
    expect(profile.learning_method.first_use_instruction).toContain('一次只走一条路径');
  });

  it('separates shared foundation from practice tracks', async () => {
    const profile = await loadProductProfile();
    expect(profile.learning_architecture.shared_foundation.map(({ id }) => id)).toEqual([
      'ai_foundation_cognition', 'stable_ai_usage', 'agents_and_workflows',
    ]);
    expect(profile.learning_architecture.practice_tracks.map(({ id }) => id)).toEqual([
      'ai_content_creation', 'ai_video_production', 'ai_tools_and_productivity',
    ]);
  });

  it.each([
    ['learning_path', 'confirmed_delivered'],
    ['ai_content_automation', 'confirmed_delivered'],
    ['codex_practice', 'confirmed_delivered'],
    ['complete_projects', 'confirmed_container'],
    ['templates_and_downloads', 'confirmed_container'],
    ['ai_video_production', 'direction_confirmed_delivery_unverified'],
  ] as const)('marks %s as %s', async (moduleId, deliveryStatus) => {
    await expect(getProductModule(moduleId)).resolves.toMatchObject({ delivery_status: deliveryStatus });
  });

  it('does not invent project, case, or template totals', async () => {
    const profile = await loadProductProfile();
    for (const moduleId of ['complete_projects', 'real_case_library', 'templates_and_downloads']) {
      const module = profile.delivery_catalog.find(({ id }) => id === moduleId);
      expect(module).toBeDefined();
      expect(module).not.toHaveProperty('count');
      expect(module).not.toHaveProperty('total');
    }
  });

  it('caps AI video at 3 while allowing full content automation fit', async () => {
    await expect(getMaximumProductFitScore('ai_video_production')).resolves.toBeLessThanOrEqual(3);
    await expect(getMaximumProductFitScore('ai_content_automation')).resolves.toBe(10);
  });
});

describe('pricing truth', () => {
  it('records current and standard annual prices', async () => {
    const profile = await loadProductProfile();
    expect(profile.pricing.current_offer.price_cny).toBe(365);
    expect(profile.pricing.standard_price.price_cny).toBe(499);
    expect(profile.pricing.current_offer.requires_refresh_before_public_sales_content).toBe(true);
  });

  it('records the first 200 member offer without fabricating current availability', async () => {
    const { early_bird: earlyBird } = (await loadProductProfile()).pricing;
    expect(earlyBird.first_member_limit).toBe(200);
    expect(earlyBird.remaining_slots).toBeNull();
    expect(earlyBird.current_member_index).toBeNull();
    expect(earlyBird.exact_remaining_claim_allowed).toBe(false);
    expect(earlyBird.countdown_claim_allowed).toBe(false);
  });

  it('keeps numeric price truth out of project.yaml', async () => {
    const project = await readFile(path.join(rootDir, 'config', 'project.yaml'), 'utf8');
    expect(project).toContain('product_profile: config/product.yaml');
    expect(project).not.toMatch(/price_cny|365|499/);
  });

  it('rejects remaining-slot and price-increase deadline claims', async () => {
    await expect(isProductClaimAllowed('product.remaining_slots')).resolves.toBe(false);
    await expect(isProductClaimAllowed('product.price_increase_deadline')).resolves.toBe(false);
  });
});

describe('product claim safeguards', () => {
  it.each([
    'product.fixed_update_frequency',
    'product.fixed_answer_frequency',
    'product.guaranteed_learning',
    'product.guaranteed_income',
    'product.member_count',
  ])('rejects forbidden claim %s', async (claimId) => {
    await expect(isProductClaimAllowed(claimId)).resolves.toBe(false);
  });

  it('allows a generic continuous-update claim without adding a frequency', async () => {
    await expect(
      isProductClaimAllowed('product.mechanism.knowledge_base.continuous_updates'),
    ).resolves.toBe(true);
    await expect(isProductClaimAllowed('product.fixed_update_frequency')).resolves.toBe(false);
  });

  it('requires evidence for ran-successfully claims', async () => {
    await expect(requiresProductEvidence('product.practice.ran_successfully')).resolves.toBe(true);
    await expect(isProductClaimAllowed('product.practice.ran_successfully')).resolves.toBe(false);
    await expect(isProductClaimAllowed('product.practice.ran_successfully', {
      evidenceReference: 'experiment:content-system-2026-08-14',
    })).resolves.toBe(true);
  });

  it('fails closed for an unknown claim id', async () => {
    await expect(isProductClaimAllowed('product.future.unverified_benefit')).resolves.toBe(false);
    await expect(getConfirmedProductClaim('product.future.unverified_benefit')).resolves.toBeNull();
  });

  it('returns only confirmed claims from getConfirmedProductClaim', async () => {
    await expect(getConfirmedProductClaim('product.name')).resolves.toBe('product.name');
    await expect(getConfirmedProductClaim('product.practice.real_project')).resolves.toBeNull();
  });

  it('keeps all claim ids non-empty and category-unique', async () => {
    const { claims } = await loadProductProfile();
    const all = [...claims.confirmed, ...claims.evidence_required, ...claims.forbidden];
    expect(all.every((id) => id.length > 0)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});
