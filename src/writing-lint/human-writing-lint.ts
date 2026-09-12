import type { WritingIssue, WritingIssueSeverity, WritingRuleOrigin } from '../writing-skills/types.js';
import { draftSentenceCv, draftSentenceLengths } from './rhythm-metrics.js';

interface ProseLine { line: number; text: string }

function proseLines(markdown: string): ProseLine[] {
  const lines = markdown.split(/\r?\n/u);
  const output: ProseLine[] = [];
  let fenced = false;
  let frontmatter = lines[0]?.trim() === '---';
  for (const [index, raw] of lines.entries()) {
    const trimmed = raw.trim();
    if (index === 0 && frontmatter) continue;
    if (frontmatter) {
      if (trimmed === '---') frontmatter = false;
      continue;
    }
    if (/^```/u.test(trimmed)) { fenced = !fenced; continue; }
    if (fenced || trimmed === '') continue;
    if (/^(?:来源|source|url|claim_id|metadata)\s*[:：]/iu.test(trimmed)) continue;
    const withoutUrlsAndCode = raw.replace(/https?:\/\/\S+/gu, '').replace(/`[^`]*`/gu, '');
    if (withoutUrlsAndCode.trim() !== '') output.push({ line: index + 1, text: withoutUrlsAndCode });
  }
  return output;
}

const HUMAN_WRITING_COMMIT = '4fda173f3fef7fb808f3eba991eeb2528ea4b189';
export const humanWritingLintRuleIds = [
  'reversal_rhetoric', 'faux_insight', 'model_signpost', 'nominalization', 'mechanical_parallelism',
  'exact_duplicate_paragraph', 'uniform_sentence_length', 'consecutive_short_sentences',
  'mechanical_summary_ending', 'fake_profound_ending',
] as const;
export const projectWritingLintRuleIds = ['business_jargon', 'contextual_business_term'] as const;

function issue(code: string, pattern: string, quoted: string, line: number, severity: WritingIssueSeverity, repair: string, origin: WritingRuleOrigin = 'human-writing'): WritingIssue {
  return {
    issue_code: code,
    pattern,
    quoted_text: quoted.trim().slice(0, 240),
    location: `line ${line}`,
    severity,
    repair_constraint: repair,
    rule_origin: origin,
    source_commit: origin === 'human-writing' ? HUMAN_WRITING_COMMIT : 'project-v0',
  };
}

function firstMatch(lines: ProseLine[], expression: RegExp): { line: number; value: string } | null {
  for (const line of lines) {
    const match = expression.exec(line.text);
    expression.lastIndex = 0;
    if (match !== null) return { line: line.line, value: match[0] };
  }
  return null;
}

function allMatches(lines: ProseLine[], expression: RegExp): Array<{ line: number; value: string }> {
  const flags = expression.flags.includes('g') ? expression.flags : `${expression.flags}g`;
  const global = new RegExp(expression.source, flags);
  const matches: Array<{ line: number; value: string }> = [];
  for (const line of lines) {
    global.lastIndex = 0;
    for (const match of line.text.matchAll(global)) if (match[0] !== '') matches.push({ line: line.line, value: match[0] });
  }
  return matches;
}

function joinedFromLines(lines: ProseLine[]): string {
  return lines.map(({ text }) => text).join('\n');
}

export function lintHumanWriting(markdown: string): WritingIssue[] {
  const lines = proseLines(markdown);
  const issues: WritingIssue[] = [];
  const patterns = [
    ['reversal_rhetoric', '翻案腔', /(?:不是|并非).{0,40}(?:而是|是)|与其.{0,30}不如|看似.{0,30}实则|你以为.{0,30}其实/u, '直接陈述有证据的判断，不先虚构误解。'],
    ['faux_insight', '假洞察开头', /(?:大多数人|很多人|所有人).{0,20}(?:忽略|没想到|不知道)|(?:最容易|真正).{0,12}(?:忽略|被忽略)|这才是.{0,12}(?:关键|真相)/u, '删除抬高作者位置的提示语，让判断靠证据成立。'],
    ['model_signpost', '模型路标', /(?:值得注意的是|需要指出的是|更微妙的是|还有一层|只说对了一半|从某种意义上说)/u, '删除路标，直接给事实、动作或判断。'],
    ['nominalization', '名词化', /(?:完成|实现|进行|达成)了?(?:对|关于)?[^。！？]{1,24}(?:的优化|的提升|的改进|的建设|的赋能)/u, '让动词直接承担动作，并保留可核验结果。'],
  ] as const;
  for (const [code, name, expression, repair] of patterns) {
    for (const match of allMatches(lines, expression)) issues.push(issue(code, name, match.value, match.line, 'blocking_style_issue', repair));
  }
  const hardJargon = firstMatch(lines, /(?:商业闭环|价值闭环|迭代闭环|赋能|组合拳|降本增效|心智占领|占领心智)/u);
  if (hardJargon !== null) issues.push(issue('business_jargon', '商业黑话', hardJargon.value, hardJargon.line, 'blocking_style_issue', '改成具体动作、数字或结果。', 'project'));
  const contextualJargon = firstMatch(lines, /(?:学习闭环|反馈闭环|执行闭环|颗粒度|协同|方法论)/u);
  if (contextualJargon !== null) issues.push(issue('contextual_business_term', '需要语境核对的术语', contextualJargon.value, contextualJargon.line, 'warning', '如果这个词替代了具体动作或结果，请补出动作与验收；否则可保留。', 'project'));

  for (const line of lines) {
    const clauses = line.text.split(/[，,；;]/u).map((value) => value.trim()).filter(Boolean);
    if (clauses.length >= 3) {
      const starters = clauses.slice(0, 4).map((value) => value.match(/^(要|先|再|把|让|从|既要|不仅)/u)?.[0] ?? '');
      if (starters.filter(Boolean).length >= 3 && new Set(starters.filter(Boolean)).size <= 2) {
        issues.push(issue('mechanical_parallelism', '机械排比', line.text, line.line, 'blocking_style_issue', '保留两项以内，同构第三项改成事实推进或删除。'));
        break;
      }
    }
  }

  const paragraphs = markdown.split(/\n\s*\n/u).map((value) => value.replace(/\s+/gu, '')).filter((value) => value.length >= 12 && !value.startsWith('```'));
  const seen = new Set<string>();
  for (const paragraph of paragraphs) {
    if (seen.has(paragraph)) {
      issues.push(issue('exact_duplicate_paragraph', '完全重复段落', paragraph, 1, 'blocking_style_issue', '删除完全重复的段落；语义重复留给 Reviewer 判断。'));
      break;
    }
    seen.add(paragraph);
  }

  const joined = joinedFromLines(lines);
  const lengths = draftSentenceLengths(joined);
  if (lengths.length >= 6 && draftSentenceCv(joined) < 0.08) {
    issues.push(issue('uniform_sentence_length', '句长过度整齐', joined.slice(0, 240), lines[0]?.line ?? 1, 'blocking_style_issue', '按信息需要调整句子，不要机械拉齐长度。'));
  }
  let consecutiveShort = 0;
  for (const length of lengths) {
    consecutiveShort = length <= 8 ? consecutiveShort + 1 : 0;
    if (consecutiveShort >= 4) {
      issues.push(issue('consecutive_short_sentences', '连续短句', joined.slice(0, 240), lines[0]?.line ?? 1, 'warning', '合并只为制造节奏的碎句，保留真正需要停顿的短句。'));
      break;
    }
  }
  const finalProse = lines.at(-1);
  if (finalProse !== undefined && /(?:总之|综上|归根结底|最终|说到底)/u.test(finalProse.text)) {
    issues.push(issue('mechanical_summary_ending', '机械总结结尾', finalProse.text, finalProse.line, 'blocking_style_issue', '结束在最后一个具体结果、边界或下一步。'));
  } else if (finalProse !== undefined && /(?:时代|浪潮|钥匙|答案|未来).{0,16}(?:开始|照亮|打开|属于|远方)/u.test(finalProse.text)) {
    issues.push(issue('fake_profound_ending', '假深刻结尾', finalProse.text, finalProse.line, 'blocking_style_issue', '删除升华句，回到清楚的具体结论。'));
  }
  return issues;
}
