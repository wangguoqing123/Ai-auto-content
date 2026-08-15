import type { CorpusDocument } from './types.js';
import type { QuantitativeFeatures } from './schemas.js';

function visibleLength(value: string): number {
  return (value.match(/[\p{Script=Han}\p{L}\p{N}]/gu) ?? []).length;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[。！？!?；;])/u).map((value) => value.trim()).filter(Boolean);
}

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/u).map((value) => value.trim()).filter(Boolean);
}

function quantile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const result = sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
  return Number(result.toFixed(3));
}

function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Number((Math.sqrt(variance) / mean).toFixed(4));
}

function density(matches: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((matches / denominator).toFixed(6));
}

function matchCount(text: string, expression: RegExp): number {
  return [...text.matchAll(expression)].length;
}

function distribution(values: string[], keys: readonly string[]): Record<string, number> {
  const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<string, number>;
  if (values.length === 0) return result;
  for (const value of values) result[value] = Number(((result[value] ?? 0) + 1 / values.length).toFixed(6));
  return result;
}

function openingType(text: string): string {
  const first = sentences(text)[0] ?? text.trim().slice(0, 100);
  if (/[?？]/u.test(first)) return 'question';
  if (/(?:我|我们).{0,12}(?:那天|当时|昨天|今天|上周|去年|刚刚)/u.test(first)) return 'anecdote';
  if (/(?:我认为|我的判断|结论|可以直接)/u.test(first)) return 'direct_judgment';
  if (/(?:如果|想要|需要|准备|先把)/u.test(first)) return 'task_entry';
  return 'other';
}

function endingType(text: string): string {
  const last = sentences(text).at(-1) ?? text.trim().slice(-100);
  if (/(?:加入|关注|扫码|点击|留言|回复)/u.test(last)) return 'cta';
  if (/(?:试试|检查|开始|保存|完成|去做)/u.test(last)) return 'action';
  if (/(?:总之|总结|归根结底|综上)/u.test(last)) return 'summary';
  return 'other';
}

function ctaPosition(text: string): string {
  const expression = /(?:加入|关注|扫码|点击|留言|回复)/u;
  const match = expression.exec(text);
  if (match === null) return 'none';
  const ratio = match.index / Math.max(text.length, 1);
  if (ratio < 0.33) return 'early';
  if (ratio < 0.67) return 'middle';
  return 'late';
}

function evidenceDistance(text: string): { distance: number; judgmentCount: number } {
  const evidence = [...text.matchAll(/(?:\d+(?:\.\d+)?%?|根据|数据显示|实测|来源|截图)/gu)].map((match) => match.index ?? 0);
  const judgments = [...text.matchAll(/(?:我认为|我的判断|因此|所以|说明|意味着)/gu)].map((match) => match.index ?? 0);
  if (evidence.length === 0 || judgments.length === 0) return { distance: 0, judgmentCount: 0 };
  const distances = judgments.map((position) => Math.min(...evidence.map((other) => Math.abs(position - other))));
  return { distance: distances.reduce((sum, value) => sum + value, 0) / distances.length, judgmentCount: judgments.length };
}

export function computeRhythmMetrics(documents: readonly CorpusDocument[]): QuantitativeFeatures {
  const texts = documents.map(({ text }) => text);
  const joined = texts.join('\n');
  const allSentences = texts.flatMap(sentences);
  const allParagraphs = texts.flatMap(paragraphs);
  const sentenceLengths = allSentences.map(visibleLength);
  const paragraphLengths = allParagraphs.map(visibleLength);
  const chineseCharacters = (joined.match(/\p{Script=Han}/gu) ?? []).length;
  const oneSentenceParagraphs = allParagraphs.filter((paragraph) => sentences(paragraph).length <= 1).length;
  const questionCount = matchCount(joined, /[？?]/gu);
  const exclamationCount = matchCount(joined, /[！!]/gu);
  const headingCount = texts.reduce((sum, text) => sum + text.split(/\r?\n/u).filter((line) => /^#{1,6}\s/u.test(line)).length, 0);
  const listCount = texts.reduce((sum, text) => sum + text.split(/\r?\n/u).filter((line) => /^\s*(?:[-*+] |\d+[.)、]\s*)/u.test(line)).length, 0);
  const lineCount = Math.max(1, texts.reduce((sum, text) => sum + text.split(/\r?\n/u).length, 0));
  const titleLengths = documents.map(({ title }) => visibleLength(title));
  const perDocumentEvidenceDistance = texts.map(evidenceDistance);
  const evidenceJudgments = perDocumentEvidenceDistance.reduce((sum, item) => sum + item.judgmentCount, 0);
  const weightedEvidenceDistance = evidenceJudgments === 0 ? 0 : perDocumentEvidenceDistance.reduce(
    (sum, item) => sum + item.distance * item.judgmentCount,
    0,
  ) / evidenceJudgments;
  return {
    sample_count: documents.length,
    chinese_char_count: chineseCharacters,
    sentence_length_p10: quantile(sentenceLengths, 0.1),
    sentence_length_p50: quantile(sentenceLengths, 0.5),
    sentence_length_p90: quantile(sentenceLengths, 0.9),
    sentence_length_cv: coefficientOfVariation(sentenceLengths),
    paragraph_length_p10: quantile(paragraphLengths, 0.1),
    paragraph_length_p50: quantile(paragraphLengths, 0.5),
    paragraph_length_p90: quantile(paragraphLengths, 0.9),
    one_sentence_paragraph_ratio: allParagraphs.length === 0 ? 0 : Number((oneSentenceParagraphs / allParagraphs.length).toFixed(6)),
    first_person_ratio: density(matchCount(joined, /(?:我|我们|本人)/gu), chineseCharacters),
    question_ratio: allSentences.length === 0 ? 0 : Number((questionCount / allSentences.length).toFixed(6)),
    exclamation_ratio: allSentences.length === 0 ? 0 : Number((exclamationCount / allSentences.length).toFixed(6)),
    conjunction_density: density(matchCount(joined, /(?:但是|不过|因此|所以|因为|如果|同时|然后|而且|以及)/gu), chineseCharacters),
    abstract_noun_density: density(matchCount(joined, /(?:能力|价值|意义|效率|体验|认知|逻辑|体系|趋势|方法论)/gu), chineseCharacters),
    action_verb_density: density(matchCount(joined, /(?:打开|点击|输入|运行|检查|保存|删除|创建|修改|测试|选择|完成|发布)/gu), chineseCharacters),
    numerical_detail_density: density(matchCount(joined, /\d+(?:\.\d+)?(?:%|个|次|分钟|小时|天|元)?/gu), chineseCharacters),
    example_density: density(matchCount(joined, /(?:例如|比如|举个例子|实测|案例)/gu), chineseCharacters),
    evidence_distance: Number(weightedEvidenceDistance.toFixed(3)),
    heading_density: Number((headingCount / lineCount).toFixed(6)),
    list_density: Number((listCount / lineCount).toFixed(6)),
    opening_type_distribution: distribution(texts.map(openingType), ['question', 'anecdote', 'direct_judgment', 'task_entry', 'other']),
    ending_type_distribution: distribution(texts.map(endingType), ['cta', 'action', 'summary', 'other']),
    cta_position_distribution: distribution(texts.map(ctaPosition), ['early', 'middle', 'late', 'none']),
    title_length_distribution: { p10: quantile(titleLengths, 0.1), p50: quantile(titleLengths, 0.5), p90: quantile(titleLengths, 0.9) },
  };
}
