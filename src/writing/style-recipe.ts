import { sha256, stableJson } from '../style-intelligence/hash.js';
import type { ArticleType } from '../style-intelligence/schemas.js';
import type { ResolvedWritingStyle } from './style-approval-resolver.js';
import { resolvedWritingStyleSnapshot, rulesForWriter } from './style-approval-resolver.js';
import type { ResolvedStyleRule, WritingIntelligenceConfig } from './schemas.js';

export interface WritingSelectedRule {
  rule_id: string;
  source_role: 'owner' | 'reference' | 'conflict' | 'platform';
  source_profile_id: string | null;
  source_weight: number;
  selection_reason: string;
  scope: string;
  applicable_platforms: string[];
  applicable_article_types: ArticleType[];
  category: ResolvedStyleRule['category'];
  text: string;
}

export interface PlatformStyleRecipe {
  platform: 'wechat' | 'x';
  article_type: ArticleType;
  source_weights: { owner: number; reference: number; platform: number };
  selected_rules: WritingSelectedRule[];
  recipe_hash: string;
}

export interface WritingStyleRecipes {
  wechat: PlatformStyleRecipe;
  x: PlatformStyleRecipe;
  recipe_hash: string;
  selected_rule_ids: string[];
}

const wechatPlatformRules: ResolvedStyleRule[] = [
  {
    rule_id: 'PLATFORM-WECHAT-LONGFORM', source_role: 'platform', source_profile_id: 'wechat-platform-v0', category: 'structure',
    text: '公众号围绕一个主要问题完整推进，第一屏说明读者能获得什么；不要把长文切成整篇碎句。', decision: 'platform_rule',
    scope: '只控制公众号长文组织，不提供作者声音。', applicable_platforms: ['wechat'], applicable_article_types: ['tutorial', 'analysis', 'case_breakdown', 'opinion', 'checklist'], confidence: 'high',
  },
  {
    rule_id: 'PLATFORM-WECHAT-EVIDENCE', source_role: 'platform', source_profile_id: 'wechat-platform-v0', category: 'evidence',
    text: '事实证据放在相关判断附近，保留来源限制、失败点、验收标准与适用边界。', decision: 'platform_rule',
    scope: '公开正文不显示内部 Claim、Source、Segment、Profile 或 Rule ID。', applicable_platforms: ['wechat'], applicable_article_types: ['tutorial', 'analysis', 'case_breakdown', 'opinion', 'checklist'], confidence: 'high',
  },
  {
    rule_id: 'PLATFORM-WECHAT-CTA', source_role: 'platform', source_profile_id: 'wechat-platform-v0', category: 'cta',
    text: '正文先交付完整价值，最多保留一个低风险行动提示。', decision: 'platform_rule',
    scope: '不得升级 Research CTA；产品承接关闭时不得加入销售表达。', applicable_platforms: ['wechat'], applicable_article_types: ['tutorial', 'analysis', 'case_breakdown', 'opinion', 'checklist'], confidence: 'high',
  },
];

function sourceWeight(rule: ResolvedStyleRule, weights: PlatformStyleRecipe['source_weights']): number {
  if (rule.source_role === 'reference') return weights.reference;
  if (rule.source_role === 'platform') return weights.platform;
  return weights.owner;
}

function selectRules(
  style: ResolvedWritingStyle,
  platform: 'wechat' | 'x',
  articleType: ArticleType,
  weights: PlatformStyleRecipe['source_weights'],
): WritingSelectedRule[] {
  const candidates = rulesForWriter(style, platform, articleType);
  const ownerAndConflict = candidates.filter(({ source_role, category }) => source_role !== 'reference' && source_role !== 'platform' && !(platform === 'wechat' && source_role === 'owner' && category === 'structure'));
  const references = platform === 'wechat' ? candidates.filter(({ source_role, category }) => source_role === 'reference' && !['voice', 'lexical', 'first_person'].includes(category)) : [];
  const selected = platform === 'wechat'
    ? [...ownerAndConflict.slice(0, 7), ...references.slice(0, 4), ...wechatPlatformRules.filter(({ applicable_article_types }) => applicable_article_types.includes(articleType))]
    : ownerAndConflict.slice(0, 10);
  return selected.map((rule, index) => ({
    rule_id: rule.rule_id,
    source_role: rule.source_role,
    source_profile_id: rule.source_profile_id,
    source_weight: sourceWeight(rule, weights),
    selection_reason: `${platform} ${articleType} deterministic approved-rule selection at position ${index + 1}`,
    scope: rule.scope,
    applicable_platforms: [...rule.applicable_platforms],
    applicable_article_types: [...rule.applicable_article_types],
    category: rule.category,
    text: rule.text,
  }));
}

function recipe(platform: 'wechat' | 'x', articleType: ArticleType, weights: PlatformStyleRecipe['source_weights'], selectedRules: WritingSelectedRule[]): PlatformStyleRecipe {
  const body = { platform, article_type: articleType, source_weights: weights, selected_rules: selectedRules };
  return { ...body, recipe_hash: sha256(stableJson(body)) };
}

export function buildWritingStyleRecipes(
  style: ResolvedWritingStyle,
  articleType: ArticleType,
  config: WritingIntelligenceConfig,
): WritingStyleRecipes {
  const snapshot = resolvedWritingStyleSnapshot(style);
  if (snapshot.excluded_rule_ids.some((id) => !['OCV-09', 'CON-05'].includes(id))) throw new Error('unexpected_excluded_style_rule');
  const wechatWeights = config.source_weights.wechat;
  const xWeights = config.source_weights.x;
  const wechat = recipe('wechat', articleType, wechatWeights, selectRules(style, 'wechat', articleType, wechatWeights));
  const x = recipe('x', articleType, xWeights, selectRules(style, 'x', articleType, xWeights));
  const all = [...wechat.selected_rules, ...x.selected_rules];
  for (const id of [...snapshot.excluded_rule_ids, ...snapshot.deleted_rule_ids]) {
    if (all.some(({ rule_id }) => rule_id === id)) throw new Error('closed_style_rule_selected');
  }
  if (wechat.selected_rules.some(({ source_role, category }) => source_role === 'reference' && ['voice', 'lexical', 'first_person'].includes(category))) throw new Error('reference_voice_selected');
  if (x.selected_rules.some(({ source_role }) => source_role === 'reference' || source_role === 'platform')) throw new Error('x_requires_owner_only_style');
  const selectedRuleIds = [...new Set(all.map(({ rule_id }) => rule_id))];
  return { wechat, x, recipe_hash: sha256(stableJson({ wechat: wechat.recipe_hash, x: x.recipe_hash })), selected_rule_ids: selectedRuleIds };
}
