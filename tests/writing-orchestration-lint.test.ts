import { describe, expect, it } from 'vitest';
import { adaptHumanWriting } from '../src/writing-skills/human-writing-adapter.js';
import { adaptNoAiSlopReview } from '../src/writing-skills/no-ai-slop-adapter.js';
import { resolveRuleConflict } from '../src/writing-skills/rule-precedence.js';
import { lintHumanWriting } from '../src/writing-lint/human-writing-lint.js';
import { lintNoAiSlop } from '../src/writing-lint/no-ai-slop-lint.js';

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
});
