import { describe, expect, it } from 'vitest';
import { adaptHumanWriting } from '../src/writing-skills/human-writing-adapter.js';
import { adaptNoAiSlopReview } from '../src/writing-skills/no-ai-slop-adapter.js';
import { resolveRuleConflict } from '../src/writing-skills/rule-precedence.js';
import { lintHumanWriting } from '../src/writing-lint/human-writing-lint.js';
import { lintNoAiSlop } from '../src/writing-lint/no-ai-slop-lint.js';
import { buildEntityNamingAudit, entityNamingIssue } from '../src/writing-lint/entity-naming-audit.js';

const context = { article_type: 'tutorial' as const, material_count: 8, factual_mode: 'nonfiction' as const };

describe('writing Skill orchestration and deterministic lint', () => {
  it('does not load human-writing revision rules before the first draft', () => {
    const before = adaptHumanWriting(context, 'pre_draft');
    const after = adaptHumanWriting(context, 'post_draft');
    expect(before.positive_rules.length).toBeGreaterThan(0);
    expect(before.revision_rules).toEqual([]);
    expect(after.positive_rules).toEqual([]);
    expect(after.revision_rules.length).toBeGreaterThan(0);
  });

  it('keeps no-ai-slop detect-only and never returns a full rewrite', () => {
    const issue = lintNoAiSlop('先说结论：这个方案可以直接用。')[0]!;
    const review = adaptNoAiSlopReview([issue]);
    expect(review).toMatchObject({ mode: 'detect_only', permits_full_text_rewrite: false, permits_new_facts_examples_or_opinions: false });
    expect(review).not.toHaveProperty('rewritten_text');
  });

  it('resolves conflicts using facts before style and reviewer rules', () => {
    const fact = { source: 'research_fact_and_evidence' as const, rule: 'keep verified number' };
    const style = { source: 'owner_style_profile' as const, rule: 'prefer fewer numbers' };
    expect(resolveRuleConflict(fact, style)).toBe(fact);
    expect(resolveRuleConflict({ source: 'human_writing_positive_rule', rule: 'a' }, { source: 'no_ai_slop_review_rule', rule: 'b' })).toMatchObject({ rule: 'a' });
  });

  it('does not flag normal colons in URLs, code, metadata, sources, or tutorial list labels', () => {
    const text = `---\ntitle: 离线测试\n---\n来源：https://example.com/a:b\n\n1. 输入：选择测试文件\n2. 输出：保存报告\n\n\`field:value\` 保持原样。\n\n\`\`\`ts\nconst url = 'https://example.com/a:b';\n\`\`\``;
    expect(lintNoAiSlop(text).filter(({ issue_code }) => issue_code === 'colon_reveal')).toEqual([]);
    expect(lintHumanWriting(text).filter(({ issue_code }) => issue_code === 'model_signpost')).toEqual([]);
  });

  it('recognizes reversal rhetoric and faux-insight setups', () => {
    const issues = lintHumanWriting('这不是一个设置问题，而是认知升级。\n\n大多数人都忽略了真正的关键。');
    expect(issues.map(({ issue_code }) => issue_code)).toEqual(expect.arrayContaining(['reversal_rhetoric', 'faux_insight']));
  });

  it('reports every reversal occurrence before the single local Repair pass', () => {
    const text = '这不是摘要，而是执行卡。\n\n这不是补全，而是保留缺口。';
    expect(lintHumanWriting(text).filter(({ issue_code }) => issue_code === 'reversal_rhetoric')).toHaveLength(2);
    expect(lintNoAiSlop(text).filter(({ issue_code }) => issue_code === 'binary_contrast')).toHaveLength(2);
  });

  it('recognizes overly uniform sentence lengths and consecutive short sentences', () => {
    const issues = lintHumanWriting('我打开文件。你保存结果。他运行检查。我重新回读。你记录错误。他保留输入。');
    expect(issues.map(({ issue_code }) => issue_code)).toEqual(expect.arrayContaining(['uniform_sentence_length', 'consecutive_short_sentences']));
  });

  it('recognizes mechanical parallelism, jargon, model signposts, nominalization, and bad endings', () => {
    const text = '要提升认知，要占领心智，要形成闭环。\n\n值得注意的是，我们完成了对流程的优化。\n\n总之，以上就是全部内容。';
    const codes = lintHumanWriting(text).map(({ issue_code }) => issue_code);
    expect(codes).toEqual(expect.arrayContaining(['mechanical_parallelism', 'business_jargon', 'model_signpost', 'nominalization', 'mechanical_summary_ending']));
  });

  it('treats dramatic colon reveals as contextual warnings, not blanket hard blockers', () => {
    const issues = lintNoAiSlop('真正的关键：让另一个模型负责评分。');
    expect(issues).toContainEqual(expect.objectContaining({ issue_code: 'colon_reveal', severity: 'warning' }));
  });

  it('does not mistake a normal tutorial list for mechanical prose', () => {
    const issues = lintHumanWriting('1. 打开设置页面\n2. 选择测试文件\n3. 保存检查报告');
    expect(issues.map(({ issue_code }) => issue_code)).not.toContain('mechanical_parallelism');
  });

  it('does not infer synonym cycling from unrelated tutorial nouns', () => {
    const text = '在 Codex 平台中调用两个工具，把飞书应用接入内容系统。工具、平台、应用和系统各自代表不同对象。';
    expect(lintHumanWriting(text).map(({ issue_code }) => issue_code)).not.toContain('synonym_cycling');
  });

  it('keeps learning loops contextual while blocking commercial jargon', () => {
    const contextual = lintHumanWriting('这套学习闭环包括练习、检查和复盘。');
    expect(contextual).toContainEqual(expect.objectContaining({ issue_code: 'contextual_business_term', severity: 'warning' }));
    expect(contextual.some(({ severity }) => severity === 'blocking_style_issue')).toBe(false);
    for (const phrase of ['商业闭环', '价值闭环', '降本增效']) {
      expect(lintHumanWriting(`我们要实现${phrase}。`)).toContainEqual(expect.objectContaining({ issue_code: 'business_jargon', severity: 'blocking_style_issue' }));
    }
  });

  it('only blocks synonym cycling after structured same-referent confirmation', () => {
    const safe = buildEntityNamingAudit({ entity_id: 'entity-1', labels_used: ['工具', '平台'], locations: ['block 1', 'block 2'], is_same_referent: false });
    expect(entityNamingIssue(safe)).toBeNull();
    const confirmed = buildEntityNamingAudit({ entity_id: 'entity-1', labels_used: ['Codex', '这个工具'], locations: ['block 1', 'block 2'], is_same_referent: true });
    expect(entityNamingIssue(confirmed)).toMatchObject({ issue_code: 'synonym_cycling', severity: 'blocking_style_issue', rule_origin: 'project' });
  });

  it('names exact duplicate paragraphs precisely and audits rule origins', () => {
    const duplicate = '这一段完整重复，需要删除。';
    const issues = lintHumanWriting(`${duplicate}\n\n${duplicate}`);
    expect(issues).toContainEqual(expect.objectContaining({ issue_code: 'exact_duplicate_paragraph', rule_origin: 'human-writing', source_commit: '4fda173f3fef7fb808f3eba991eeb2528ea4b189' }));
    expect(lintNoAiSlop('先说结论：可以执行。')[0]).toMatchObject({ rule_origin: 'no-ai-slop', source_commit: 'd30eddb9e04562234f2070b5ee63ca4649d9a05e' });
  });
});
