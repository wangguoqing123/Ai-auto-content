export const rulePrecedence = [
  'research_fact_and_evidence',
  'persona_fact',
  'product_claim',
  'platform_hard_rule',
  'owner_style_profile',
  'current_style_recipe',
  'human_writing_positive_rule',
  'no_ai_slop_review_rule',
] as const;

export type RuleSource = typeof rulePrecedence[number];

export function rulePriority(source: RuleSource): number {
  return rulePrecedence.indexOf(source);
}

export function resolveRuleConflict<T extends { source: RuleSource }, U extends { source: RuleSource }>(left: T, right: U): T | U {
  return rulePriority(left.source) <= rulePriority(right.source) ? left : right;
}
