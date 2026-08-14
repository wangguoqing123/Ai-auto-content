import type { ResearchPack } from './schemas.js';

function value(text: string): string {
  return text.replace(/\r?\n/g, ' ').trim();
}

export function renderResearchReport(pack: ResearchPack): string {
  const lines = [
    `# ${pack.research_date} 研究与实验包`,
    '',
    '## 研究决定',
    '',
    pack.status === 'failed' ? `failed (${pack.error_code ?? 'unknown'})` : (pack.decision ?? 'UNKNOWN'),
    '',
    '## 母题',
    '',
  ];
  if (pack.topic === null) lines.push('- 无可研究母题。');
  else {
    lines.push(
      `- 工作标题：${value(pack.topic.working_title)}`,
      `- 用户阶段：${pack.topic.learner_stage}`,
      `- 产品模块：${pack.topic.primary_product_module_id}`,
      `- CTA：${pack.topic.cta_mode}`,
    );
  }
  lines.push('', '## 来源', '');
  if (pack.sources.length === 0) lines.push('- 未抓取来源。');
  for (const source of pack.sources) {
    lines.push(
      `### ${value(source.title || source.material_id)}`,
      '',
      `- URL：${source.canonical_url}`,
      `- 抓取状态：${source.fetch_status}`,
      `- 内容哈希：${source.content_sha256 ?? 'null'}`,
      `- 抓取时间：${source.retrieved_at ?? 'null'}`,
      '',
    );
  }
  lines.push('## 已核验事实', '');
  if (pack.verified_claims.length === 0) lines.push('- 无。');
  for (const claim of pack.verified_claims) {
    lines.push(
      `### ${value(claim.claim)}`,
      '',
      `- 短引用：${value(claim.quote)}`,
      `- 来源：${claim.source_id ?? 'null'}`,
      `- 段落：${claim.segment_id ?? 'null'}`,
      `- 支持强度：${claim.support_status}`,
      `- 范围限制：${value(claim.scope_limit) || '无'}`,
      '',
    );
  }
  lines.push('## 研究问题', '');
  for (const answer of pack.research_answers) {
    lines.push(
      `### ${value(answer.question)}`,
      '',
      `- 状态：${answer.answer_status}`,
      `- 回答：${value(answer.answer) || '无'}`,
      `- 支持 Claim：${answer.supporting_claim_ids.join(', ') || '无'}`,
      `- 未解决缺口：${value(answer.remaining_gap) || '无'}`,
      '',
    );
  }
  lines.push('## 实验', '');
  if (pack.experiment === null) lines.push('- 本次不要求实验或实验未完成。');
  else {
    const [baseline, structured] = pack.experiment.results;
    lines.push(
      `- 任务：${pack.experiment.spec.task_id}`,
      `- Variant A：${baseline.status}，通过 ${baseline.criterion_pass_count}/${baseline.criterion_results.length}`,
      `- Variant B：${structured.status}，通过 ${structured.criterion_pass_count}/${structured.criterion_results.length}`,
      `- 可观察差异：${pack.experiment.observable_differences.map(value).join('；')}`,
      `- 限制：${pack.experiment.limitations.map(value).join('；')}`,
    );
  }
  lines.push(
    '',
    '## 写作必须包含',
    '',
    `- 核心承诺：${value(pack.writing_requirements.main_promise)}`,
    `- 最小结果：${value(pack.writing_requirements.minimum_result)}`,
    `- 必须使用的 Claim：${pack.writing_requirements.required_claim_ids.join(', ') || '无'}`,
    ...pack.writing_requirements.required_disclosures.map((item) => `- 披露：${value(item)}`),
    ...pack.writing_requirements.required_visual_evidence.map((item) => `- 证据：${value(item)}`),
    '',
    '## 禁止写法',
    '',
    ...pack.writing_requirements.forbidden_claims.map((item) => `- ${value(item)}`),
    '- 不把 UGC 当事实。',
    '- 不写效率百分比、最好用、普遍化结论或虚构亲测。',
    '- READY_FOR_WRITING 不等于已经写稿。',
    '',
  );
  return lines.join('\n');
}
