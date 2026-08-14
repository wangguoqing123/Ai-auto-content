import type { ContentFitProfile, CtaMode } from '../product/content-fit-profile.js';
import type { ProductProfile } from '../product/product-profile.js';
import { resolveEvidenceReference, validateEvidenceReferences } from './evidence-reference.js';
import { checkRecentDuplicate, computeTopicSignature, normalizeTopicText, type TopicHistoryEntry } from './history.js';
import {
  topicCandidateSchema,
  type NoPublishReasonCode,
  type TopicCandidate,
  type TopicCandidateProposal,
  type TopicIntelligenceConfig,
  type TopicMaterialCard,
} from './schemas.js';

export async function evidenceReferenceExists(
  reference: string,
  rootDir: string,
  materials: Map<string, TopicMaterialCard>,
): Promise<boolean> {
  return resolveEvidenceReference(reference, { rootDir, materials, requireFactMaterial: true });
}

export interface CandidateEvaluationContext {
  rootDir: string;
  config: TopicIntelligenceConfig;
  product: ProductProfile;
  contentFit: ContentFitProfile;
  materials: Map<string, TopicMaterialCard>;
  history: TopicHistoryEntry[];
  exactHistory?: TopicHistoryEntry[];
  similarityHistory?: TopicHistoryEntry[];
  contentMix: Record<string, number>;
}

function addUnique(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function materialIdsHaveRole(
  ids: string[],
  role: TopicMaterialCard['role'],
  materials: Map<string, TopicMaterialCard>,
): boolean {
  return ids.every((id) => materials.get(id)?.role === role);
}

function maximumCtaForModules(
  moduleIds: string[],
  product: ProductProfile,
  contentFit: ContentFitProfile,
): CtaMode {
  const modes: CtaMode[] = ['none', 'light', 'club'];
  const modules = moduleIds.map((id) => product.delivery_catalog.find((module) => module.id === id));
  if (modules.some((module) => module === undefined)) return 'none';
  const allowed = modes.filter((mode) => modules.every((module) => module !== undefined
    && contentFit.cta_rules[mode].allowed_delivery_statuses.includes(module.delivery_status)));
  return allowed.includes('club') ? 'club' : allowed.includes('light') ? 'light' : 'none';
}

function ctaStrength(mode: CtaMode): number {
  return mode === 'club' ? 2 : mode === 'light' ? 1 : 0;
}

function experimentLanguage(candidate: TopicCandidateProposal): boolean {
  const text = [candidate.working_title, candidate.one_sentence_promise, candidate.core_angle, candidate.proof_format].join(' ');
  return /实测|对比|效率|最好用|更准确|更快|成本更低|自动化效果|模型能力比较|工作流效果|亲测有效/iu.test(text);
}

function containsFabricatedFirstPerson(candidate: TopicCandidateProposal): boolean {
  const text = [
    candidate.working_title,
    candidate.one_sentence_promise,
    candidate.core_angle,
    candidate.why_now,
    ...candidate.supported_claims.map(({ claim }) => claim),
  ].join(' ');
  return /(?:我|七天假)(?:亲测|实测|使用后|赚到|做到|发现|验证)/u.test(text);
}

function capProductFit(
  candidate: TopicCandidateProposal,
  product: ProductProfile,
  contentFit: ContentFitProfile,
): { cap: number; moduleMappingValid: boolean } {
  const pillar = contentFit.content_pillars.find(({ id }) => id === candidate.content_pillar);
  if (pillar === undefined) return { cap: 0, moduleMappingValid: false };
  const moduleIds = [candidate.primary_product_module_id, ...candidate.supporting_product_module_ids];
  const caps: number[] = [];
  let moduleMappingValid = true;
  for (const moduleId of moduleIds) {
    const module = product.delivery_catalog.find(({ id }) => id === moduleId);
    const mapping = contentFit.module_mapping.find((item) => item.module_id === moduleId);
    if (module === undefined || mapping === undefined || !mapping.content_pillar_ids.includes(candidate.content_pillar)) {
      moduleMappingValid = false;
      caps.push(0);
    } else {
      caps.push(contentFit.fit_rules.delivery_status_score_caps[module.delivery_status]);
    }
  }
  return { cap: Math.min(pillar.maximum_product_fit_score, ...(caps.length > 0 ? caps : [0])), moduleMappingValid };
}

async function validateProductClaims(candidate: TopicCandidateProposal, context: CandidateEvaluationContext): Promise<string[]> {
  const reasons: string[] = [];
  const evidenceByClaim = new Map(candidate.product_claim_evidence.map((item) => [item.claim_id, item.evidence_refs]));
  for (const claimId of candidate.product_claim_ids) {
    if (context.product.claims.forbidden.includes(claimId)) {
      addUnique(reasons, `forbidden_product_claim:${claimId}`);
      continue;
    }
    if (context.product.claims.confirmed.includes(claimId)) continue;
    if (!context.product.claims.evidence_required.includes(claimId)) {
      addUnique(reasons, `unknown_product_claim:${claimId}`);
      continue;
    }
    const references = evidenceByClaim.get(claimId) ?? [];
    if (references.length === 0) {
      addUnique(reasons, `missing_product_claim_evidence:${claimId}`);
      continue;
    }
    for (const reference of references) {
      if (!await resolveEvidenceReference(reference, {
        rootDir: context.rootDir,
        materials: context.materials,
        requireFactMaterial: true,
      })) {
        addUnique(reasons, `invalid_product_claim_evidence:${claimId}`);
      }
    }
  }
  return reasons;
}

export async function evaluateCandidate(
  proposal: TopicCandidateProposal,
  context: CandidateEvaluationContext,
): Promise<TopicCandidate> {
  const candidate = structuredClone(proposal);
  const hardReasons = [...candidate.hard_reject_reasons];
  const stage = context.contentFit.learner_stages.find(({ id }) => id === candidate.learner_stage);
  const pillar = context.contentFit.content_pillars.find(({ id }) => id === candidate.content_pillar);
  if (stage === undefined) addUnique(hardReasons, 'invalid_learner_stage');
  if (pillar === undefined) addUnique(hardReasons, 'invalid_content_pillar');
  if (pillar !== undefined && !pillar.learner_stage.includes(candidate.learner_stage)) {
    addUnique(hardReasons, 'learner_stage_pillar_mismatch');
  }
  if (normalizeTopicText(candidate.user_problem).length < 8) addUnique(hardReasons, 'missing_clear_user_problem');
  if (normalizeTopicText(candidate.real_task).length < 6) addUnique(hardReasons, 'missing_real_task');
  if (normalizeTopicText(candidate.minimum_result).length < 6) addUnique(hardReasons, 'missing_minimum_result');
  if (/震惊|颠覆|封神|必看/iu.test(candidate.working_title)) addUnique(hardReasons, 'requires_exaggerated_title');
  if (containsFabricatedFirstPerson(candidate)) addUnique(hardReasons, 'unconfirmed_first_person_experience');
  if (candidate.fact_source_ids.some((id) => context.materials.get(id)?.source_platform === 'xiaohongshu')) {
    addUnique(hardReasons, 'xiaohongshu_evidence_forbidden');
  }

  if (!materialIdsHaveRole(candidate.fact_source_ids, 'fact_source', context.materials)) {
    addUnique(hardReasons, 'invalid_fact_source_reference');
  }
  if (!materialIdsHaveRole(candidate.trend_signal_ids, 'trend_signal', context.materials)) {
    addUnique(hardReasons, 'invalid_trend_signal_reference');
  }
  if (!materialIdsHaveRole(candidate.structure_inspiration_ids, 'structure_inspiration', context.materials)) {
    addUnique(hardReasons, 'invalid_structure_inspiration_reference');
  }
  if (!materialIdsHaveRole(candidate.restricted_inspiration_ids, 'restricted_inspiration_only', context.materials)) {
    addUnique(hardReasons, 'invalid_restricted_inspiration_reference');
  }
  for (const claim of candidate.supported_claims) {
    if (!materialIdsHaveRole(claim.fact_source_ids, 'fact_source', context.materials)) {
      addUnique(hardReasons, 'supported_claim_without_fact_source');
    }
  }
  if (candidate.time_sensitive && candidate.fact_source_ids.length === 0) {
    addUnique(hardReasons, 'time_sensitive_topic_without_fact_source');
  }
  if (experimentLanguage(candidate) && !candidate.requires_experiment) {
    candidate.requires_experiment = true;
    candidate.risk_flags.push('experiment_required_by_claim_language');
  }
  if (candidate.requires_experiment && candidate.experiment_plan.length === 0) {
    addUnique(hardReasons, 'experiment_plan_required');
  }

  const productFit = capProductFit(candidate, context.product, context.contentFit);
  if (!productFit.moduleMappingValid) addUnique(hardReasons, 'invalid_product_module_mapping');
  const originalFit = candidate.scores.product_fit_score;
  candidate.scores.product_fit_score = Math.min(originalFit, productFit.cap);
  const productFitCapApplied = candidate.scores.product_fit_score !== originalFit;

  const moduleIds = [candidate.primary_product_module_id, ...candidate.supporting_product_module_ids];
  let allowedCta = maximumCtaForModules(moduleIds, context.product, context.contentFit);
  if (candidate.funnel_role === 'lead_generation' && candidate.scores.product_fit_score < 7 && allowedCta === 'club') {
    allowedCta = 'light';
  }
  const requestedCta = candidate.cta_mode;
  if (ctaStrength(requestedCta) > ctaStrength(allowedCta)) candidate.cta_mode = allowedCta;
  candidate.price_refresh_required = candidate.cta_mode === 'club';

  for (const reason of await validateProductClaims(candidate, context)) addUnique(hardReasons, reason);

  const evidenceCap = candidate.fact_source_ids.length > 0
    ? 15
    : candidate.experiment_plan.length > 0 ? 10 : 5;
  candidate.scores.evidence_score = Math.min(candidate.scores.evidence_score, evidenceCap);
  const signature = computeTopicSignature(candidate);
  const noveltyEvidence = await validateEvidenceReferences(candidate.new_evidence_refs, {
    rootDir: context.rootDir,
    materials: context.materials,
    requireFactMaterial: true,
  });
  if (noveltyEvidence.invalid.length > 0) addUnique(hardReasons, 'invalid_novelty_evidence');
  const duplicate = checkRecentDuplicate(
    candidate,
    signature,
    context.exactHistory ?? context.history,
    context.similarityHistory ?? context.history,
    context.config.history.token_similarity_threshold,
    noveltyEvidence.valid,
  );
  if (duplicate.duplicate) addUnique(hardReasons, duplicate.reason ?? 'duplicate_recent_topic');

  const totalScore = candidate.scores.pain_score
    + candidate.scores.actionability_score
    + candidate.scores.demonstrability_score
    + candidate.scores.evidence_score
    + candidate.scores.engagement_potential_score
    + candidate.scores.product_fit_score;
  return topicCandidateSchema.parse({
    ...candidate,
    hard_reject_reasons: hardReasons,
    scores: { ...candidate.scores, total_score: totalScore },
    topic_signature: signature,
    effective_product_fit_cap: productFit.cap,
    product_fit_cap_applied: productFitCapApplied,
    cta_adjusted_from: candidate.cta_mode !== requestedCta ? requestedCta : null,
    evaluation_status: hardReasons.length === 0 && totalScore >= context.config.candidates.approval_score
      ? 'approved' : 'rejected',
  });
}

function specificity(value: string): number {
  return Math.min(500, normalizeTopicText(value).length);
}

function maturity(candidate: TopicCandidate): number {
  return candidate.effective_product_fit_cap;
}

function exaggerationPenalty(candidate: TopicCandidate): number {
  return /震惊|颠覆|封神|必看|must see|game.?changing/iu.test(candidate.working_title) ? 1 : 0;
}

export function chooseApprovedCandidate(
  candidates: TopicCandidate[],
  config: TopicIntelligenceConfig,
  history: TopicHistoryEntry[],
  contentMix: Record<string, number>,
): TopicCandidate | null {
  const approved = candidates.filter(({ evaluation_status }) => evaluation_status === 'approved');
  if (approved.length === 0) return null;
  const historyCount = new Map<string, number>();
  for (const item of history) historyCount.set(item.contentPillar, (historyCount.get(item.contentPillar) ?? 0) + 1);
  return approved.sort((left, right) => {
    const scoreDifference = right.scores.total_score - left.scores.total_score;
    if (Math.abs(scoreDifference) > config.candidates.close_score_tie_range) return scoreDifference;
    const factors: Array<[number, number]> = [
      [specificity(right.user_problem), specificity(left.user_problem)],
      [specificity(right.minimum_result), specificity(left.minimum_result)],
      [right.fact_source_ids.length + right.experiment_plan.length, left.fact_source_ids.length + left.experiment_plan.length],
      [maturity(right), maturity(left)],
      [(contentMix[right.content_pillar] ?? 0) - (historyCount.get(right.content_pillar) ?? 0) / Math.max(1, history.length),
        (contentMix[left.content_pillar] ?? 0) - (historyCount.get(left.content_pillar) ?? 0) / Math.max(1, history.length)],
      [/产品|任务|验收|流程/u.test(right.core_angle) ? 1 : 0, /产品|任务|验收|流程/u.test(left.core_angle) ? 1 : 0],
      [-exaggerationPenalty(right), -exaggerationPenalty(left)],
    ];
    for (const [rightFactor, leftFactor] of factors) if (rightFactor !== leftFactor) return rightFactor - leftFactor;
    return left.candidate_id.localeCompare(right.candidate_id);
  })[0] ?? null;
}

export function inferNoPublishReason(candidates: TopicCandidate[]): { code: NoPublishReasonCode; reason: string } {
  if (candidates.length === 0) return { code: 'all_candidates_hard_rejected', reason: '模型没有提出可评估候选。' };
  if (candidates.every(({ hard_reject_reasons }) => hard_reject_reasons.length > 0)) {
    if (candidates.some(({ hard_reject_reasons }) => hard_reject_reasons.some((reason) => reason.startsWith('duplicate_')))) {
      return { code: 'duplicate_recent_topic', reason: '候选与最近 30 天母题重复，且没有满足条件的新证据或新结果。' };
    }
    if (candidates.some(({ hard_reject_reasons }) => hard_reject_reasons.includes('time_sensitive_topic_without_fact_source'))) {
      return { code: 'insufficient_fact_evidence', reason: '时效主题缺少可追溯的一手事实来源。' };
    }
    return { code: 'all_candidates_hard_rejected', reason: '所有候选都触发了硬性淘汰条件。' };
  }
  if (candidates.every(({ scores }) => scores.actionability_score < 12)) {
    return { code: 'weak_actionability', reason: '候选无法交付一个足够明确、可立即执行的小结果。' };
  }
  if (candidates.every(({ scores }) => scores.product_fit_score < 3)) {
    return { code: 'weak_product_or_account_fit', reason: '候选与账号目标用户或已确认产品模块的关系不足。' };
  }
  return { code: 'no_candidate_above_threshold', reason: '没有候选同时通过硬性校验并达到 80 分。' };
}
