import type { WritingIssue } from '../writing-skills/types.js';

const NO_AI_SLOP_COMMIT = 'd30eddb9e04562234f2070b5ee63ca4649d9a05e';
const auditFields = { rule_origin: 'no-ai-slop' as const, source_commit: NO_AI_SLOP_COMMIT };
export const noAiSlopLintRuleIds = [
  'binary_contrast', 'throat_clearing', 'faux_insight_setup', 'superficial_analysis', 'importance_puffery',
  'interpretive_metadiscourse', 'weasel_attribution', 'rhetorical_setup', 'colon_reveal', 'summary_recap_ending',
] as const;

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/u).length;
}

function proseOnly(markdown: string): string {
  const lines = markdown.split(/\r?\n/u);
  let fenced = false;
  let frontmatter = lines[0]?.trim() === '---';
  return lines.map((line, index) => {
    const trimmed = line.trim();
    if (index === 0 && frontmatter) return '';
    if (frontmatter) { if (trimmed === '---') frontmatter = false; return ''; }
    if (/^```/u.test(trimmed)) { fenced = !fenced; return ''; }
    if (fenced || /^(?:来源|source|url|claim_id|metadata)\s*[:：]/iu.test(trimmed)) return '';
    return line.replace(/https?:\/\/\S+/gu, '').replace(/`[^`]*`/gu, '');
  }).join('\n');
}

export function lintNoAiSlop(markdown: string): WritingIssue[] {
  const text = proseOnly(markdown);
  const definitions = [
    ['binary_contrast', 'Binary contrast', /(?:This is not|The question isn['’]t|It['’]s not just)[^.!?]{1,100}(?:It['’]s|but)|(?:不是|并非).{0,40}(?:而是|是)/iu, 'State the supported point directly.'],
    ['throat_clearing', 'Throat-clearing opener', /(?:Here['’]s the thing|Let me be clear|I['’]ll be honest|先说结论|说白了)[,:：]?/iu, 'Delete the throat-clearing and lead with the point.'],
    ['faux_insight_setup', 'Faux-insight setup', /(?:What most people get wrong|Here['’]s what nobody tells you|The part everyone misses|大多数人.{0,12}(?:错|忽略|不知道))/iu, 'Remove the lone-expert setup and support the claim.'],
    ['superficial_analysis', 'Superficial analysis', /\b(?:highlighting|underscoring|reflecting|showcasing)\b/iu, 'Replace the trailing label with a concrete mechanism or consequence.'],
    ['importance_puffery', 'Importance puffery', /(?:stands as a testament|marks a pivotal moment|plays a vital role|underscores its significance)/iu, 'State the fact and let the reader judge its importance.'],
    ['interpretive_metadiscourse', 'Interpretive metadiscourse', /(?:That last part matters|The key point is|As you can see|This distinction matters|关键在于|重点是)/iu, 'Delete the aside or replace it with evidence.'],
    ['weasel_attribution', 'Weasel attribution', /(?:Experts agree|industry reports suggest|studies show|专家认为|研究表明|业内普遍认为)/iu, 'Name the source or remove the unsupported attribution.'],
    ['rhetorical_setup', 'Rhetorical setup', /(?:What if I told you|Think about it|Plot twist|你有没有想过|试想一下)[?？:：]?/iu, 'State the point without staging a rhetorical reveal.'],
  ] as const;
  const issues: WritingIssue[] = [];
  for (const [code, pattern, expression, repair] of definitions) {
    const flags = expression.flags.includes('g') ? expression.flags : `${expression.flags}g`;
    for (const match of text.matchAll(new RegExp(expression.source, flags))) {
      issues.push({
        issue_code: code,
        pattern,
        quoted_text: match[0],
        location: `line ${lineNumber(text, match.index)}`,
        severity: 'blocking_style_issue',
        repair_constraint: repair,
        ...auditFields,
      });
    }
  }
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (/^\s*(?:[-*+] |\d+[.)、]\s*)/u.test(line)) continue;
    const match = /(?:细节|关键|最好|真相|问题|答案|核心)[^。！？\n]{0,24}[：:](?!\/\/)([^\n]+)/u.exec(line);
    if (match !== null) issues.push({
      issue_code: 'colon_reveal', pattern: 'Colon reveal', quoted_text: match[0], location: `line ${index + 1}`,
      severity: 'warning', repair_constraint: 'Use a plain sentence; keep colons in code, URLs, metadata, labels, sources, and real lists.',
      ...auditFields,
    });
  }
  const final = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1);
  if (final !== undefined && /^(?:In conclusion|Ultimately|Overall|总之|综上)/iu.test(final)) issues.push({
    issue_code: 'summary_recap_ending', pattern: 'Summary-recap ending', quoted_text: final, location: `line ${text.split(/\r?\n/u).length}`,
    severity: 'blocking_style_issue', repair_constraint: 'End on the last concrete point, boundary, or next action.',
    ...auditFields,
  });
  return issues;
}
