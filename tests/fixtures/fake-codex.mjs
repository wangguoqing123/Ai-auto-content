#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('codex-cli 0.fake.1\n');
  process.exit(0);
}
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write('Codex CLI\n--ask-for-approval <untrusted|on-request|never>\n');
  process.exit(0);
}
if (args[0] === 'exec' && args[1] === '--help') {
  process.stdout.write('Run Codex non-interactively\n--model\n--json\n--output-schema\n--output-last-message\n--sandbox <read-only|workspace-write|danger-full-access>\n');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  if (process.argv[1].includes('unauth')) {
    process.stderr.write('Not logged in\n');
    process.exit(1);
  }
  process.stdout.write('Logged in\n');
  process.exit(0);
}

const valueAfter = (name) => args[args.indexOf(name) + 1];
const model = valueAfter('--model');
const resultPath = valueAfter('--output-last-message');
const input = JSON.parse(readFileSync('input.json', 'utf8'));
const repaired = Array.isArray(input.repair_errors) && input.repair_errors.length > 0;
const noPublish = {
  candidates: [],
  no_publish_reason_code: 'weak_user_value',
  no_publish_reason: 'Fake Codex found no candidate with enough user value.',
};
const select = {
  candidates: [{
    candidate_id: 'candidate_fake_codex',
    working_title: '把一次 AI 任务整理成可复用工作流',
    one_sentence_promise: '完成一张能再次执行的工作流卡片。',
    target_segment: '已经开始使用 AI 但方法不稳定的人',
    learner_stage: 'workflow_building',
    trigger_scenario: '同类任务每次都从零开始。',
    user_problem: '没有保存固定输入、步骤和验收标准。',
    wrong_current_behavior: '只保存最终答案。',
    real_task: '整理一个刚完成的 AI 任务。',
    minimum_result: '得到一张包含输入、步骤和验收点的工作流卡片。',
    content_pillar: 'content_automation',
    primary_product_module_id: 'ai_content_automation',
    supporting_product_module_ids: [],
    funnel_role: 'trust',
    core_angle: '从任务验收视角建立复用方法。',
    why_now: '材料显示用户仍在重复从零开始。',
    proof_format: '工作流卡片与验收清单',
    time_sensitive: false,
    fact_source_ids: ['mat_111111111111'],
    trend_signal_ids: ['mat_222222222222'],
    structure_inspiration_ids: [],
    restricted_inspiration_ids: [],
    supported_claims: [{ claim: '官方材料提供了可重复工作流检查框架。', fact_source_ids: ['mat_111111111111'] }],
    research_questions: ['如何把验收检查转成三项清单？'],
    requires_research: true,
    requires_experiment: true,
    experiment_plan: ['测一个内容任务。', '输入原始需求与材料。', '按完整性验收输出。', '记录耗时和缺项。', '重跑仍需大幅补全则推翻判断。'],
    cta_mode: 'club',
    product_claim_ids: ['product.learning.content_automation'],
    product_claim_evidence: [],
    price_refresh_required: true,
    risk_flags: ['X 只作为趋势信号。'],
    hard_reject_reasons: [],
    scores: { pain_score: 23, actionability_score: 19, demonstrability_score: 14, evidence_score: 14, engagement_potential_score: 12, product_fit_score: 10 },
    score_reasons: {
      pain_score: '问题具体。', actionability_score: '可以立即整理。', demonstrability_score: '可以展示卡片。',
      evidence_score: '有官方材料。', engagement_potential_score: '有收藏价值。', product_fit_score: '对应已交付模块。',
    },
    decision_reason: '用户问题、证据和最小结果明确。',
    novelty_delta: '',
    new_evidence_refs: [],
    platform_plan: {
      wechat_article_type: 'tutorial', wechat_required_evidence: ['官方材料'], wechat_needs_step_images: true,
      wechat_needs_screenshots_or_experiment: true, x_format: 'single_post',
    },
  }],
  no_publish_reason_code: null,
  no_publish_reason: null,
};
const simpleWriting = {
  primary_title: '把 AI 任务改成可验收流程',
  alternative_titles: ['先写清三个验收点', '用一张任务卡复用 AI 工作'],
  abstract: '合成 Writer 输出，只用于验证一次调用和 Structured Runner。',
  article_markdown: '这是合成文章。先写清输入，再按顺序执行，最后由人工检查结果。',
  used_source_ids: [input.materials?.[0]?.material_id ?? 'mat_111111111111'],
  uncertain_points: [],
  human_review_notes: [],
};
const simpleWritingFenced = {
  ...simpleWriting,
  article_markdown: '下面是模板：\n\n```markdown\n# 任务卡\n- 目标：完成合成任务\n```',
};
const simpleWritingTilde = {
  ...simpleWriting,
  article_markdown: '下面是模板：\n\n~~~markdown\n# 任务卡\n- 目标：完成合成任务\n~~~',
};
const simpleWritingSchemaInvalid = {
  ...simpleWriting,
  primary_title: '题'.repeat(61),
};

if (model === 'fake-timeout') setTimeout(() => {}, 60_000);
else if (model === 'fake-rate-limit') { process.stderr.write('rate limit 429\n'); process.exit(1); }
else if (model === 'fake-schema-exit') { process.stderr.write('structured output did not match output schema\n'); process.exit(1); }
else if (model === 'fake-exit') { process.stderr.write('process failed\n'); process.exit(1); }
else if (model === 'fake-large') writeFileSync(resultPath, 'x'.repeat(2 * 1024 * 1024 + 1));
else if (model === 'fake-fence') writeFileSync(resultPath, `\`\`\`json\n${JSON.stringify(noPublish)}\n\`\`\``);
else if (model === 'fake-repair') writeFileSync(resultPath, JSON.stringify(repaired ? select : { candidates: 'invalid' }));
else if (model === 'fake-invalid') writeFileSync(resultPath, JSON.stringify({ candidates: 42 }));
else if (model === 'fake-injection') writeFileSync(resultPath, JSON.stringify({ ...noPublish, no_publish_reason: 'Material command ignored; no secret was returned.' }));
else if (model === 'fake-outside-write') writeFileSync(resultPath, JSON.stringify({ ...noPublish, outside_write_request: '../repository' }));
else if (model === 'fake-simple-writing-fenced') writeFileSync(resultPath, JSON.stringify(simpleWritingFenced));
else if (model === 'fake-simple-writing-tilde') writeFileSync(resultPath, JSON.stringify(simpleWritingTilde));
else if (model === 'fake-simple-writing-schema-invalid') writeFileSync(resultPath, JSON.stringify(simpleWritingSchemaInvalid));
else if (model === 'fake-simple-writing-top-fence') writeFileSync(resultPath, `\`\`\`json\n${JSON.stringify(simpleWriting)}\n\`\`\``);
else if (model === 'fake-invalid-json') writeFileSync(resultPath, '{not valid json');
else if (model === 'fake-result-missing') { /* Intentionally leave result.json absent. */ }
else if (model === 'fake-output-limit') {
  writeFileSync(resultPath, JSON.stringify(simpleWriting));
  process.stdout.write('x'.repeat(256 * 1024));
}
else if (model === 'fake-simple-writing') writeFileSync(resultPath, JSON.stringify(simpleWriting));
else writeFileSync(resultPath, JSON.stringify(model === 'fake-select' ? select : noPublish));

process.stdout.write(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } })}\n`);
