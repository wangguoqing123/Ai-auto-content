import { loadContentFitProfile } from './load-content-fit-profile.js';
import { loadProductProfile } from './load-product-profile.js';
import type { CtaMode } from './content-fit-profile.js';
import type { ProductClaimId, ProductModule, ProductModuleId } from './product-profile.js';

export interface ProductClaimOptions {
  evidenceReference?: string;
  rootDir?: string;
}

function normalizedEvidenceReference(options: ProductClaimOptions): string | undefined {
  const reference = options.evidenceReference?.trim();
  return reference === '' ? undefined : reference;
}

export async function getConfirmedProductClaim(
  claimId: ProductClaimId,
  rootDir = process.cwd(),
): Promise<ProductClaimId | null> {
  const profile = await loadProductProfile(rootDir);
  return profile.claims.confirmed.includes(claimId) ? claimId : null;
}

export async function isProductClaimAllowed(
  claimId: ProductClaimId,
  options: ProductClaimOptions = {},
): Promise<boolean> {
  const profile = await loadProductProfile(options.rootDir);
  if (profile.claims.forbidden.includes(claimId)) return false;
  if (profile.claims.confirmed.includes(claimId)) return true;
  if (profile.claims.evidence_required.includes(claimId)) {
    return normalizedEvidenceReference(options) !== undefined;
  }
  return false;
}

export async function requiresProductEvidence(
  claimId: ProductClaimId,
  rootDir = process.cwd(),
): Promise<boolean> {
  const profile = await loadProductProfile(rootDir);
  return profile.claims.evidence_required.includes(claimId);
}

export async function getProductModule(
  moduleId: ProductModuleId,
  rootDir = process.cwd(),
): Promise<ProductModule | undefined> {
  const profile = await loadProductProfile(rootDir);
  return profile.delivery_catalog.find(({ id }) => id === moduleId);
}

export async function getMaximumProductFitScore(
  moduleId: ProductModuleId,
  rootDir = process.cwd(),
): Promise<number> {
  const [module, contentFit] = await Promise.all([
    getProductModule(moduleId, rootDir),
    loadContentFitProfile(rootDir),
  ]);
  if (module === undefined) return 0;
  return contentFit.fit_rules.delivery_status_score_caps[module.delivery_status];
}

export async function getAllowedCtaModes(
  moduleId: ProductModuleId,
  rootDir = process.cwd(),
): Promise<CtaMode[]> {
  const [module, contentFit] = await Promise.all([
    getProductModule(moduleId, rootDir),
    loadContentFitProfile(rootDir),
  ]);
  if (module === undefined) return ['none'];
  const modes: CtaMode[] = [];
  for (const mode of ['none', 'light', 'club'] as const) {
    if (contentFit.cta_rules[mode].allowed_delivery_statuses.includes(module.delivery_status)) {
      modes.push(mode);
    }
  }
  return modes.length > 0 ? modes : ['none'];
}
