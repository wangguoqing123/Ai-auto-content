import type { TopicCandidate, TopicDecision, TopicMaterialCard } from './schemas.js';

function safeLink(card: TopicMaterialCard): string {
  if (card.role === 'restricted_inspiration_only' || card.canonical_url === null) return '';
  return ` — ${card.canonical_url}`;
}

function materialLines(ids: string[], materials: Map<string, TopicMaterialCard>): string[] {
  if (ids.length === 0) return ['- 无'];
  return ids.map((id) => {
    const card = materials.get(id);
    return card === undefined ? `- ${id} — 输入中不存在` : `- ${card.material_id} — ${card.title}${safeLink(card)}`;
  });
}

function selectedTopicSection(topic: TopicCandidate): string[] {
  return [
    '## 最终母题',
    '',
    `- 工作标题：${topic.working_title}`,
    `- 适合谁：${topic.target_segment}`,
    `- 学习阶段：${topic.learner_stage}`,
    `- 用户场景：${topic.trigger_scenario}`,
    `- 用户问题：${topic.user_problem}`,
    `- 当前错误做法：${topic.wrong_current_behavior}`,
    `- 真实任务：${topic.real_task}`,
    `- 最小结果：${topic.minimum_result}`,
    `- 为什么现在值得做：${topic.why_now}`,
    `- Content Pillar：${topic.content_pillar}`,
    `- 主要产品模块：${topic.primary_product_module_id}`,
    `- Funnel Role：${topic.funnel_role}`,
    `- CTA Mode：${topic.cta_mode}`,
    `- 总分：${topic.scores.total_score}`,
    `- 产品适配上限：${topic.effective_product_fit_cap}`,
    `- 是否需要研究：${topic.requires_research ? '是' : '否'}`,
    `- 是否需要实验：${topic.requires_experiment ? '是' : '否'}`,
    '',
    '## 评分',
    '',
    `- 痛点 ${topic.scores.pain_score}/25：${topic.score_reasons.pain_score}`,
    `- 可行动性 ${topic.scores.actionability_score}/20：${topic.score_reasons.actionability_score}`,
    `- 可展示性 ${topic.scores.demonstrability_score}/15：${topic.score_reasons.demonstrability_score}`,
    `- 证据 ${topic.scores.evidence_score}/15：${topic.score_reasons.evidence_score}`,
    `- 互动潜力 ${topic.scores.engagement_potential_score}/15：${topic.score_reasons.engagement_potential_score}`,
    `- 产品适配 ${topic.scores.product_fit_score}/10：${topic.score_reasons.product_fit_score}`,
  ];
}

export function renderTopicReport(decision: TopicDecision, materials: Map<string, TopicMaterialCard>): string {
  const selected = decision.selected_topic;
  const lines = [
    `# ${decision.decision_date} 每日选题决定`,
    '',
    '## 今日决定',
    '',
    decision.decision ?? 'FAILED',
    '',
  ];
  if (selected !== null) lines.push(...selectedTopicSection(selected), '');
  if (decision.decision === 'NO_PUBLISH') {
    lines.push('## 未发布原因', '', `- ${decision.no_publish_reason_code}：${decision.no_publish_reason}`, '');
  }
  if (selected !== null) {
    lines.push(
      '## 证据角色', '',
      '### 事实来源', '', ...materialLines(selected.fact_source_ids, materials), '',
      '### 趋势信号', '', ...materialLines(selected.trend_signal_ids, materials), '',
      '### 结构参考', '', ...materialLines(selected.structure_inspiration_ids, materials), '',
      '### 限制使用材料', '', ...materialLines(selected.restricted_inspiration_ids, materials), '',
      '## 需要补充的研究', '',
      ...(selected.research_questions.length > 0 ? selected.research_questions.map((item) => `- ${item}`) : ['- 无']),
      ...(selected.risk_flags.length > 0 ? selected.risk_flags.map((item) => `- 证据缺口：${item}`) : []),
      ...(selected.experiment_plan.length > 0 ? selected.experiment_plan.map((item, index) => `- 实验 ${index + 1}：${item}`) : ['- 实验：不需要']),
      '',
      '## 不应怎样写', '',
      '- 不把 X 互动量写成事实、爆款概率或增长速度。',
      '- 不把 UGC、公众号结构参考或 restricted 材料写成事实来源。',
      '- 不把他人经历改写成七天假的第一人称经历。',
      '- 不使用未确认产品权益、剩余名额、固定频率、倒计时或结果保证。',
      '- 需要实测、效率、速度、准确率或工具优劣结论时，先完成并记录实验。',
      '',
      '## 平台计划', '',
      `- 公众号文章类型：${selected.platform_plan.wechat_article_type}`,
      `- 公众号所需证据：${selected.platform_plan.wechat_required_evidence.join('；') || '无'}`,
      `- 是否需要步骤图：${selected.platform_plan.wechat_needs_step_images ? '是' : '否'}`,
      `- 是否需要截图或实验：${selected.platform_plan.wechat_needs_screenshots_or_experiment ? '是' : '否'}`,
      `- X：${selected.platform_plan.x_format}`,
      '',
      '## 产品承接', '',
      `- ${selected.cta_mode}`,
      `- product claim IDs：${selected.product_claim_ids.join(', ') || '无'}`,
      `- price_refresh_required：${selected.price_refresh_required}`,
      '',
    );
  }
  const reasons = new Map<string, number>();
  for (const candidate of decision.evaluated_candidates) {
    for (const reason of candidate.hard_reject_reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    if (candidate.hard_reject_reasons.length === 0 && candidate.evaluation_status === 'rejected') {
      reasons.set('below_approval_threshold', (reasons.get('below_approval_threshold') ?? 0) + 1);
    }
  }
  const rejected = decision.evaluated_candidates.filter(({ evaluation_status }) => evaluation_status === 'rejected').length;
  lines.push(
    '## 淘汰摘要', '',
    `- 淘汰数量：${rejected}`,
    ...([...reasons.entries()].map(([reason, count]) => `- ${reason}：${count}`)),
    '',
  );
  return `${lines.join('\n')}\n`;
}
