import { researchPackSchema, type ExperimentOutput, type ResearchPack } from '../research/schemas.js';
import { sha256, stableJson } from '../style-intelligence/hash.js';

const createdAt = '2026-08-14T06:30:00.000Z';
const sourceId = 'source_a1b2c3d4e5f6';
const materialId = 'mat_a1b2c3d4e5f6';

function experimentOutput(structured: boolean): ExperimentOutput {
  return {
    deliverable: {
      title: '会议记录执行卡',
      objective: '把三项待办整理成可分工、可追踪、可验收的行动清单。',
      decisions: ['保留原始三项待办', '不补猜第三项的验收标准', '缺少截止时间的事项明确标记待确认'],
      actions: [
        { task: '整理客户反馈', owner: '负责人甲', next_step: '按原记录汇总反馈', acceptance_condition: '形成一页分类清单' },
        { task: '更新演示文稿', owner: '负责人乙', next_step: '在截止日前更新', acceptance_condition: '演示文件可打开且章节齐全' },
        { task: '确认发布安排', owner: '负责人丙', next_step: '补充验收标准后执行', acceptance_condition: structured ? '待负责人确认' : '' },
      ],
      acceptance_checklist: ['三项待办均保留', '每项均有负责人', '两项截止时间不被改写', '缺失的验收标准明确标记'],
      risks: ['第三项没有验收标准', '一项没有截止时间'],
    },
    assumptions: structured ? [] : ['未提供的信息不做补猜'],
    missing_inputs: ['第三项的验收标准', '一项待办的截止时间'],
    steps_taken: ['提取待办、负责人、截止时间和验收条件', '对照原始记录检查缺口'],
    self_check: [
      { criterion_id: 'deliverable_present', status: 'pass', evidence: '已生成行动清单' },
      { criterion_id: 'required_fields_complete', status: structured ? 'pass' : 'fail', evidence: structured ? '字段均存在，缺口显式标记' : '一项验收条件为空' },
      { criterion_id: 'missing_inputs_explicit', status: 'pass', evidence: '列出两项缺失输入' },
      { criterion_id: 'executable_next_steps', status: 'pass', evidence: '每项均有下一步' },
      { criterion_id: 'acceptance_mapped', status: structured ? 'pass' : 'uncertain', evidence: '未虚构第三项验收条件' },
      { criterion_id: 'assumptions_bounded', status: 'pass', evidence: '没有补猜原记录' },
      { criterion_id: 'strict_output_format', status: 'pass', evidence: '通过结构化 schema' },
      { criterion_id: 'no_major_supplementation', status: 'pass', evidence: '只使用合成输入' },
    ],
  };
}

function result(variant: 'baseline_chat_request' | 'structured_task_card', structured: boolean) {
  const output = experimentOutput(structured);
  const criterion_results = output.self_check.map(({ criterion_id, status, evidence }) => ({ criterion_id, status, evidence }));
  return {
    variant_id: variant,
    status: 'success' as const,
    output_parse_status: 'valid' as const,
    duration_ms: structured ? 1_200 : 1_000,
    token_usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
    codex_exit_status: 'success' as const,
    criterion_results,
    criterion_pass_count: criterion_results.filter(({ status }) => status === 'pass').length,
    criterion_fail_count: criterion_results.filter(({ status }) => status === 'fail').length,
    missing_required_fields: [],
    output,
  };
}

export function buildSyntheticReadyResearchPack(): ResearchPack {
  const quotes = [
    { claim_id: 'claim_fixture_tasks', segment_id: 'p0001', quote: '合成记录包含三个待办事项，每项一个负责人，其中两项有截止时间。' },
    { claim_id: 'claim_fixture_gap', segment_id: 'p0002', quote: '第三项待办缺少验收标准，输出目标是一张行动清单。' },
  ];
  const baseline = result('baseline_chat_request', false);
  const structured = result('structured_task_card', true);
  const body = {
    version: 1 as const,
    research_date: '2026-08-14',
    run_id: 'research_2026-08-14T06-30-00-000Z',
    status: 'success' as const,
    decision: 'READY_FOR_WRITING' as const,
    topic: {
      topic_signature: sha256('synthetic-ready-meeting-notes-action-card'),
      topic_run_id: 'topic_synthetic_ready_fixture',
      working_title: '把一段会议记录整理成一张可验收的执行卡',
      learner_stage: 'task_breakdown' as const,
      content_pillar: 'codex_and_productivity' as const,
      primary_product_module_id: 'ai_tools_and_productivity',
      cta_mode: 'light' as const,
    },
    input_hash: sha256('synthetic-ready-research-pack-v1'),
    source_summary: { requested: 1, fetched: 1, failed: 0, unsupported_content_type: 0, canonical_success: 1, canonical_blocked: 0, rss_replay_success: 0, persisted_excerpt_used: 0, unavailable: 0 },
    sources: [{
      source_id: sourceId, material_id: materialId, canonical_url: 'https://example.invalid/ai-auto-content/synthetic-meeting-notes',
      final_url: 'https://example.invalid/ai-auto-content/synthetic-meeting-notes', title: '项目自有合成会议记录', author: 'AI Auto Content fixture',
      retrieved_at: createdAt, content_type: 'text/plain', content_sha256: sha256(quotes.map(({ quote }) => quote).join('\n')),
      fetch_status: 'success' as const, retrieval_method: 'canonical_http' as const, content_scope: 'full_page' as const,
      retrieval_url: 'https://example.invalid/ai-auto-content/synthetic-meeting-notes', canonical_fetch_status: 'success' as const,
      canonical_http_status: 200, fallback_reason: null, snapshot_collected_at: createdAt, selected_quotes: quotes, error_code: null,
    }],
    verified_claims: [
      { claim_id: 'claim_fixture_tasks', claim: '合成记录有三个待办，每项一个负责人，两项有截止时间。', support_status: 'direct' as const, source_id: sourceId, segment_id: 'p0001', quote: quotes[0]!.quote, scope_limit: '只描述这个项目自有合成样例。', notes: '不得外推其他会议记录。' },
      { claim_id: 'claim_fixture_gap', claim: '第三项缺少验收标准，目标输出是行动清单。', support_status: 'direct' as const, source_id: sourceId, segment_id: 'p0002', quote: quotes[1]!.quote, scope_limit: '缺失项必须保留为待确认。', notes: '不得补写验收标准。' },
    ],
    research_answers: [{
      question: '怎样把合成会议记录变成可验收执行卡？', answer_status: 'answered' as const, gap_impact: 'none' as const,
      answer: '保留任务、负责人和已有截止时间，把缺失验收标准标为待确认，并输出行动清单。',
      supporting_claim_ids: ['claim_fixture_tasks', 'claim_fixture_gap'], remaining_gap: '',
    }],
    experiment: {
      spec: {
        task_id: 'meeting_notes_to_decision_log' as const, type: 'text_to_text' as const, input_sha256: sha256('synthetic meeting notes input'),
        model: 'offline-synthetic-fixture', timeout_ms: 60_000,
        variants: [
          { variant_id: 'baseline_chat_request' as const, prompt_sha256: sha256('baseline') },
          { variant_id: 'structured_task_card' as const, prompt_sha256: sha256('structured') },
        ],
      },
      results: [baseline, structured],
      observable_differences: [
        `当前一个合成样例中，普通请求通过 ${baseline.criterion_pass_count} 项验收，结构化执行卡通过 ${structured.criterion_pass_count} 项。`,
        '两组均保留了缺失输入；结构化执行卡把缺失验收标准显式标记。',
      ],
      limitations: ['只有一个合成样例。', '每组只运行一次，没有测量模型波动。', '结果不能外推其他任务、模型和用户。'],
    },
    writing_requirements: {
      main_promise: '读者能把一段会议记录整理成一张可验收的执行卡。',
      minimum_result: '得到包含任务、负责人、截止时间、验收条件和缺口标记的行动清单。',
      required_claim_ids: ['claim_fixture_tasks', 'claim_fixture_gap'],
      required_disclosures: ['只有一个合成样例。', '每组只运行一次，没有测量模型波动。', '结果不能外推其他任务、模型和用户。'],
      forbidden_claims: ['不得声称效率提升百分比。', '不得声称这是最佳工作流。', '不得虚构七天假的亲测经历。'],
      required_visual_evidence: ['合成会议记录', '执行卡字段', '逐项验收结果'],
    },
    readiness: { fact_claims_verified: true, research_questions_sufficient: true, experiment_completed: true, open_gaps: [] },
    model: { provider: 'fixture', model: 'offline-synthetic-fixture', runtime_version: 'fixture-v1', calls: 0, duration_ms: 0, usage: null },
    error_code: null,
    error_message_safe: null,
    created_at: createdAt,
  };
  return researchPackSchema.parse({ ...body, input_hash: sha256(stableJson({ fixture: 'synthetic-ready-research-pack-v1', topic: body.topic })) });
}
