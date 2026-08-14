import { z } from 'zod';

const stableIdSchema = z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/);
const moduleIdSchema = z.string().min(1).regex(/^[a-z0-9][a-z0-9_]*$/);
const nonEmptyTextSchema = z.string().trim().min(1);

export const deliveryStatusSchema = z.enum([
  'confirmed_delivered',
  'confirmed_container',
  'confirmed_partial',
  'direction_confirmed_delivery_unverified',
  'unknown',
]);

export const productClaimIdSchema = stableIdSchema;
export const productModuleIdSchema = moduleIdSchema;

const principleSchema = z.strictObject({
  id: moduleIdSchema,
  name: nonEmptyTextSchema,
  explanation: nonEmptyTextSchema,
});

const mechanismSchema = z.strictObject({
  id: moduleIdSchema,
  name: nonEmptyTextSchema,
  facts: z.array(nonEmptyTextSchema).min(1),
  constraints: z.array(nonEmptyTextSchema),
});

const learningModuleSchema = z.strictObject({
  id: moduleIdSchema,
  name: nonEmptyTextSchema,
  topics: z.array(nonEmptyTextSchema).min(1),
});

const practiceTrackSchema = z.strictObject({
  id: moduleIdSchema,
  name: nonEmptyTextSchema,
  description: nonEmptyTextSchema,
  module_ids: z.array(moduleIdSchema).min(1),
});

export const deliveryCatalogItemSchema = z.strictObject({
  id: moduleIdSchema,
  name: nonEmptyTextSchema,
  delivery_status: deliveryStatusSchema,
  description: nonEmptyTextSchema,
  evidence_basis: z.array(stableIdSchema).min(1),
  confirmed_items: z.array(nonEmptyTextSchema),
  visible_topics: z.array(nonEmptyTextSchema),
  constraints: z.array(nonEmptyTextSchema),
  product_value: nonEmptyTextSchema.nullable(),
});

export const productProfileSchema = z.strictObject({
  version: z.literal(2),
  updated_at: z.iso.date(),
  evidence_basis: z.array(stableIdSchema).min(1),
  product: z.strictObject({
    id: stableIdSchema,
    name: nonEmptyTextSchema,
    brand_line: nonEmptyTextSchema,
    owner: nonEmptyTextSchema,
    product_type: stableIdSchema,
  }),
  positioning: z.strictObject({
    primary: nonEmptyTextSchema,
    core_promise: nonEmptyTextSchema,
    transformation: z.strictObject({
      from: z.array(nonEmptyTextSchema).min(1),
      to: z.array(nonEmptyTextSchema).min(1),
    }),
    final_goal: nonEmptyTextSchema,
  }),
  audience: z.strictObject({
    primary: z.array(nonEmptyTextSchema).min(1),
    suitable_for: z.array(nonEmptyTextSchema).min(1),
    not_suitable_for: z.array(nonEmptyTextSchema).min(1),
  }),
  learning_method: z.strictObject({
    first_use_instruction: nonEmptyTextSchema,
    principles: z.array(principleSchema).min(3),
  }),
  mechanisms: z.array(mechanismSchema).min(4),
  learning_architecture: z.strictObject({
    shared_foundation: z.array(learningModuleSchema).min(1),
    practice_tracks: z.array(practiceTrackSchema).min(1),
  }),
  delivery_catalog: z.array(deliveryCatalogItemSchema).min(1),
  pricing: z.strictObject({
    currency: z.literal('CNY'),
    billing_period: z.literal('year'),
    current_offer: z.strictObject({
      price_cny: z.number().int().positive(),
      status: z.literal('user_confirmed_current'),
      verified_at: z.iso.date(),
      requires_refresh_before_public_sales_content: z.literal(true),
    }),
    standard_price: z.strictObject({
      price_cny: z.number().int().positive(),
      source: stableIdSchema,
    }),
    early_bird: z.strictObject({
      first_member_limit: z.number().int().positive(),
      remaining_slots: z.number().int().nonnegative().nullable(),
      current_member_index: z.number().int().positive().nullable(),
      exact_remaining_claim_allowed: z.literal(false),
      countdown_claim_allowed: z.literal(false),
    }),
  }),
  claims: z.strictObject({
    confirmed: z.array(productClaimIdSchema).min(1),
    evidence_required: z.array(productClaimIdSchema),
    forbidden: z.array(productClaimIdSchema).min(1),
  }),
  unknown_fields: z.array(productClaimIdSchema).min(1),
}).superRefine((profile, context) => {
  const uniqueGroups: Array<[string, string[]]> = [
    ['mechanism', profile.mechanisms.map(({ id }) => id)],
    ['learning principle', profile.learning_method.principles.map(({ id }) => id)],
    ['shared foundation', profile.learning_architecture.shared_foundation.map(({ id }) => id)],
    ['practice track', profile.learning_architecture.practice_tracks.map(({ id }) => id)],
    ['delivery module', profile.delivery_catalog.map(({ id }) => id)],
  ];
  for (const [label, ids] of uniqueGroups) {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) context.addIssue({ code: 'custom', message: `Duplicate ${label} id: ${id}` });
      seen.add(id);
    }
  }

  const claimCategoryById = new Map<string, string>();
  for (const [category, ids] of Object.entries(profile.claims)) {
    for (const id of ids) {
      const previousCategory = claimCategoryById.get(id);
      if (previousCategory !== undefined) {
        context.addIssue({
          code: 'custom',
          message: `Claim id appears in both ${previousCategory} and ${category}: ${id}`,
        });
      }
      claimCategoryById.set(id, category);
    }
  }

  const confirmed = new Set(profile.claims.confirmed);
  for (const id of profile.unknown_fields) {
    if (confirmed.has(id)) {
      context.addIssue({ code: 'custom', message: `Unknown field cannot be confirmed: ${id}` });
    }
  }
});

export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;
export type ProductClaimId = z.infer<typeof productClaimIdSchema>;
export type ProductModuleId = z.infer<typeof productModuleIdSchema>;
export type ProductModule = z.infer<typeof deliveryCatalogItemSchema>;
export type ProductProfile = z.infer<typeof productProfileSchema>;
