import type { WritingIssue, WritingIssueSeverity } from '../writing-skills/types.js';
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

function issue(code: string, pattern: string, quoted: string, line: number, severity: WritingIssueSeverity, repair: string): WritingIssue {
  return { issue_code: code, pattern, quoted_text: quoted.trim().slice(0, 240), location: `line ${line}`, severity, repair_constraint: repair };
}

function firstMatch(lines: ProseLine[], expression: RegExp): { line: number; value: string } | null {
  for (const line of lines) {
    const match = expression.exec(line.text);
    expression.lastIndex = 0;
    if (match !== null) return { line: line.line, value: match[0] };
  }
  return null;
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
    ['business_jargon', '商业黑话', /(?:赋能|抓手|闭环|颗粒度|组合拳|全链路|心智占领|降本增效)/u, '改成具体动作、数字或结果。'],
    ['model_signpost', '模型路标', /(?:值得注意的是|需要指出的是|更微妙的是|还有一层|只说对了一半|从某种意义上说)/u, '删除路标，直接给事实、动作或判断。'],
    ['nominalization', '名词化', /(?:完成|实现|进行|达成)了?(?:对|关于)?[^。！？]{1,24}(?:的优化|的提升|的改进|的建设|的赋能)/u, '让动词直接承担动作，并保留可核验结果。'],
  ] as const;
  for (const [code, name, expression, repair] of patterns) {
    const match = firstMatch(lines, expression);
    if (match !== null) issues.push(issue(code, name, match.value, match.line, 'blocking_style_issue', repair));
  }

  const namingWindow = /[^。！？\n]{1,160}/gu;
  for (const match of joinedFromLines(lines).matchAll(namingWindow)) {
    const terms = match[0].match(/工具|应用|平台|系统/gu) ?? [];
    if (new Set(terms).size >= 3) {
      issues.push(issue('synonym_cycling', '同义词轮换', match[0], lines[0]?.line ?? 1, 'blocking_style_issue', '同一个对象沿用同一个清楚称呼。'));
      break;
    }
  }

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
      issues.push(issue('repeated_paragraph_function', '重复段落作用', paragraph, 1, 'blocking_style_issue', '删除重复解释，下一段必须增加新事实、动作、区别或后果。'));
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
