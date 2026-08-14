import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { loadContentFitProfile } from '../product/load-content-fit-profile.js';
import { loadProductProfile } from '../product/load-product-profile.js';
import type { ContentFitProfile } from '../product/content-fit-profile.js';
import type { ProductProfile } from '../product/product-profile.js';

export interface TopicProductContext {
  positioning: string;
  transformation: { from: string[]; to: string[] };
  learningPrinciples: Array<{ id: string; name: string; explanation: string }>;
  learnerStages: ContentFitProfile['learner_stages'];
  contentPillars: ContentFitProfile['content_pillars'];
  deliveryModules: Array<{
    id: string;
    name: string;
    delivery_status: ProductProfile['delivery_catalog'][number]['delivery_status'];
    product_value: string | null;
    constraints: string[];
  }>;
  deliveryStatusCaps: ContentFitProfile['fit_rules']['delivery_status_score_caps'];
  moduleMappings: ContentFitProfile['module_mapping'];
  ctaRules: ContentFitProfile['cta_rules'];
  allowedProductClaimIds: string[];
  evidenceRequiredClaimIds: string[];
  forbiddenClaimIds: string[];
  contentMix: Record<string, number>;
  primaryIdentity: string;
  coreUserDefinition: string;
}

export interface LoadedProductTruth {
  product: ProductProfile;
  contentFit: ContentFitProfile;
  context: TopicProductContext;
  projectRaw: Record<string, unknown>;
}

export async function loadTopicProductTruth(rootDir: string): Promise<LoadedProductTruth> {
  const [product, contentFit, projectText] = await Promise.all([
    loadProductProfile(rootDir),
    loadContentFitProfile(rootDir),
    readFile(path.join(rootDir, 'config', 'project.yaml'), 'utf8'),
  ]);
  const projectRaw = parse(projectText) as Record<string, unknown>;
  const project = (projectRaw.project ?? {}) as Record<string, unknown>;
  const account = (projectRaw.account ?? {}) as Record<string, unknown>;
  const contentMix = ((projectRaw.content_mix ?? {}) as Record<string, unknown>).weights as Record<string, number> | undefined;
  return {
    product,
    contentFit,
    projectRaw,
    context: {
      positioning: product.positioning.primary,
      transformation: product.positioning.transformation,
      learningPrinciples: product.learning_method.principles,
      learnerStages: contentFit.learner_stages,
      contentPillars: contentFit.content_pillars,
      deliveryModules: product.delivery_catalog.map((module) => ({
        id: module.id,
        name: module.name,
        delivery_status: module.delivery_status,
        product_value: module.product_value,
        constraints: module.constraints,
      })),
      deliveryStatusCaps: contentFit.fit_rules.delivery_status_score_caps,
      moduleMappings: contentFit.module_mapping,
      ctaRules: contentFit.cta_rules,
      allowedProductClaimIds: product.claims.confirmed,
      evidenceRequiredClaimIds: product.claims.evidence_required,
      forbiddenClaimIds: [...new Set([...product.claims.forbidden, ...product.unknown_fields])],
      contentMix: contentMix ?? {},
      primaryIdentity: String(account.primary_identity ?? ''),
      coreUserDefinition: String(account.core_user_definition ?? ''),
    },
  };
}
