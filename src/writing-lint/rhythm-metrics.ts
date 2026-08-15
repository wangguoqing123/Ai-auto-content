export { computeRhythmMetrics } from '../style-intelligence/rhythm-metrics.js';

function visibleLength(value: string): number {
  return (value.match(/[\p{Script=Han}\p{L}\p{N}]/gu) ?? []).length;
}

export function draftSentenceLengths(text: string): number[] {
  return text.split(/(?<=[。！？!?；;])/u).map((value) => value.trim()).filter(Boolean).map(visibleLength);
}

export function draftSentenceCv(text: string): number {
  const values = draftSentenceLengths(text);
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) / mean;
}
