import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import {
  validateContentMix,
  validateProductContentFitReferences,
} from '../src/product/content-fit-profile.js';
import { loadContentFitProfile } from '../src/product/load-content-fit-profile.js';
import { loadProductProfile } from '../src/product/load-product-profile.js';

const projectStrategySchema = z.object({
  product_profile: z.literal('config/product.yaml'),
  content_fit_profile: z.literal('config/content-fit.yaml'),
  content_mix: z.strictObject({
    status: z.literal('strategy_hypothesis'),
    weights: z.record(z.string().min(1), z.number().min(0).max(1)),
    rationale: z.string().min(1),
  }),
});

function assertNoDuplicateProductTruth(project: unknown): void {
  if (typeof project !== 'object' || project === null || Array.isArray(project)) {
    throw new Error('config/project.yaml must be an object');
  }
  const forbiddenKeys = new Set(['product', 'price_cny', 'price_cny_per_year', 'current_offer', 'standard_price']);
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) {
        throw new Error(`Duplicate product truth is forbidden in config/project.yaml: ${key}`);
      }
      visit(nested);
    }
  };
  visit(project);
}

export async function checkProductContracts(rootDir = process.cwd()): Promise<{
  modules: number;
  pillars: number;
  claims: { confirmed: number; evidenceRequired: number; forbidden: number };
}> {
  const [product, contentFit, projectText] = await Promise.all([
    loadProductProfile(rootDir),
    loadContentFitProfile(rootDir),
    readFile(path.join(rootDir, 'config', 'project.yaml'), 'utf8'),
  ]);
  const rawProject = parse(projectText) as unknown;
  assertNoDuplicateProductTruth(rawProject);
  const project = projectStrategySchema.parse(rawProject);
  validateProductContentFitReferences(product, contentFit);
  validateContentMix(project.content_mix.weights, contentFit);

  return {
    modules: product.delivery_catalog.length,
    pillars: contentFit.content_pillars.length,
    claims: {
      confirmed: product.claims.confirmed.length,
      evidenceRequired: product.claims.evidence_required.length,
      forbidden: product.claims.forbidden.length,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await checkProductContracts();
  console.log(
    `Product check passed: ${result.modules} modules, ${result.pillars} content pillars, `
      + `${result.claims.confirmed}/${result.claims.evidenceRequired}/${result.claims.forbidden} `
      + 'confirmed/evidence-required/forbidden claims.',
  );
}
