import { z } from 'zod';
import {
  deliveryStatusSchema,
  productModuleIdSchema,
  type ProductProfile,
} from './product-profile.js';

const stableIdSchema = z.string().min(1).regex(/^[a-z0-9][a-z0-9_]*$/);
const nonEmptyTextSchema = z.string().trim().min(1);

export const learnerStageSchema = z.enum([
  'concept_confusion',
  'tool_selection',
  'unstable_usage',
  'task_breakdown',
  'workflow_building',
  'project_delivery',
  'continuous_improvement',
  'business_integration',
]);

export const contentPillarSchema = z.enum([
  'orientation_and_selection',
  'stable_ai_usage',
  'agents_and_workflows',
  'content_automation',
  'codex_and_productivity',
  'ai_video_production',
  'projects_cases_and_templates',
  'curation_and_community',
]);

export const ctaModeSchema = z.enum(['none', 'light', 'club']);

const learnerStageItemSchema = z.strictObject({
  id: learnerStageSchema,
  description: nonEmptyTextSchema,
});

const contentPillarItemSchema = z.strictObject({
  id: contentPillarSchema,
  name: nonEmptyTextSchema,
  learner_stage: z.array(learnerStageSchema).min(1),
  product_module_ids: z.array(productModuleIdSchema).min(1),
  typical_real_tasks: z.array(nonEmptyTextSchema).min(1),
  minimum_content_result: nonEmptyTextSchema,
  proof_formats: z.array(nonEmptyTextSchema).min(1),
  conversion_bridge: nonEmptyTextSchema,
  delivery_support_status: deliveryStatusSchema,
  maximum_product_fit_score: z.number().int().min(0).max(10),
});

const deliveryStatusScoreCapsSchema = z.strictObject({
  confirmed_delivered: z.literal(10),
  confirmed_partial: z.literal(7),
  confirmed_container: z.literal(5),
  direction_confirmed_delivery_unverified: z.literal(3),
  unknown: z.literal(0),
});

export const contentFitProfileSchema = z.strictObject({
  version: z.literal(2),
  updated_at: z.iso.date(),
  status: z.literal('strategy_hypothesis'),
  learner_stages: z.array(learnerStageItemSchema).min(1),
  content_pillars: z.array(contentPillarItemSchema).min(1),
  module_mapping: z.array(z.strictObject({
    module_id: productModuleIdSchema,
    content_pillar_ids: z.array(contentPillarSchema).min(1),
  })).min(1),
  fit_rules: z.strictObject({
    requires_explicit_module_match: z.literal(true),
    unrelated_ai_topic_score: z.literal(0),
    product_fit_score_range: z.strictObject({ min: z.literal(0), max: z.literal(10) }),
    delivery_status_score_caps: deliveryStatusScoreCapsSchema,
    rules: z.array(nonEmptyTextSchema).min(1),
  }),
  cta_rules: z.strictObject({
    none: z.strictObject({
      allowed_delivery_statuses: z.array(deliveryStatusSchema).min(1),
      description: nonEmptyTextSchema,
    }),
    light: z.strictObject({
      allowed_delivery_statuses: z.array(deliveryStatusSchema).min(1),
      description: nonEmptyTextSchema,
    }),
    club: z.strictObject({
      allowed_delivery_statuses: z.array(deliveryStatusSchema).min(1),
      description: nonEmptyTextSchema,
      constraints: z.array(nonEmptyTextSchema).min(1),
    }),
  }),
  editorial_lens: z.strictObject({
    status: z.literal('applies_to_all_content'),
    steps: z.array(nonEmptyTextSchema).min(1),
  }),
  platform_scope: z.strictObject({
    active_content_outputs: z.array(z.enum(['wechat_official_account', 'x', 'wechat_visuals'])).length(3),
    retired_content_outputs: z.array(z.literal('xiaohongshu')).length(1),
  }),
}).superRefine((profile, context) => {
  const uniqueGroups: Array<[string, string[]]> = [
    ['learner stage', profile.learner_stages.map(({ id }) => id)],
    ['content pillar', profile.content_pillars.map(({ id }) => id)],
    ['module mapping', profile.module_mapping.map(({ module_id }) => module_id)],
  ];
  for (const [label, ids] of uniqueGroups) {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) context.addIssue({ code: 'custom', message: `Duplicate ${label} id: ${id}` });
      seen.add(id);
    }
  }

  const knownStages = new Set(profile.learner_stages.map(({ id }) => id));
  const knownPillars = new Set(profile.content_pillars.map(({ id }) => id));
  for (const pillar of profile.content_pillars) {
    for (const stage of pillar.learner_stage) {
      if (!knownStages.has(stage)) {
        context.addIssue({ code: 'custom', message: `Unknown learner stage reference: ${stage}` });
      }
    }
    const cap = profile.fit_rules.delivery_status_score_caps[pillar.delivery_support_status];
    if (pillar.maximum_product_fit_score > cap) {
      context.addIssue({
        code: 'custom',
        message: `Content pillar ${pillar.id} exceeds ${pillar.delivery_support_status} cap ${cap}`,
      });
    }
  }
  for (const mapping of profile.module_mapping) {
    for (const pillarId of mapping.content_pillar_ids) {
      if (!knownPillars.has(pillarId)) {
        context.addIssue({ code: 'custom', message: `Unknown content pillar reference: ${pillarId}` });
      }
    }
  }
});

export function validateProductContentFitReferences(
  product: ProductProfile,
  contentFit: ContentFitProfile,
): void {
  const modules = new Map(product.delivery_catalog.map((module) => [module.id, module]));
  const errors: string[] = [];
  for (const pillar of contentFit.content_pillars) {
    let highestReferencedCap = 0;
    for (const moduleId of pillar.product_module_ids) {
      const module = modules.get(moduleId);
      if (module === undefined) {
        errors.push(`content pillar ${pillar.id} -> ${moduleId}`);
      } else {
        highestReferencedCap = Math.max(
          highestReferencedCap,
          contentFit.fit_rules.delivery_status_score_caps[module.delivery_status],
        );
      }
    }
    if (pillar.maximum_product_fit_score > highestReferencedCap) {
      errors.push(
        `content pillar ${pillar.id} score ${pillar.maximum_product_fit_score} exceeds referenced module cap ${highestReferencedCap}`,
      );
    }
  }
  for (const mapping of contentFit.module_mapping) {
    if (!modules.has(mapping.module_id)) errors.push(`module mapping -> ${mapping.module_id}`);
  }
  if (errors.length > 0) throw new Error(`Product/content-fit contract violation(s): ${errors.join(', ')}`);
}

export function validateContentMix(
  weights: Record<string, number>,
  contentFit: ContentFitProfile,
): void {
  const expected = new Set<string>(contentFit.content_pillars.map(({ id }) => id));
  const actual = new Set(Object.keys(weights));
  const missing = [...expected].filter((id) => !actual.has(id));
  const extra = [...actual].filter((id) => !expected.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`Content mix keys do not match pillars; missing=${missing.join(',')}; extra=${extra.join(',')}`);
  }
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(total - 1) > 0.000001) throw new Error(`Content mix must sum to 1; received ${total}`);
}

export type LearnerStage = z.infer<typeof learnerStageSchema>;
export type ContentPillar = z.infer<typeof contentPillarSchema>;
export type CtaMode = z.infer<typeof ctaModeSchema>;
export type ContentFitProfile = z.infer<typeof contentFitProfileSchema>;
