import { createHash } from 'node:crypto';
import type { CorpusDocument } from './types.js';

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function computeStyleCorpusHash(documents: readonly CorpusDocument[]): string {
  const normalized = [...documents]
    .sort((left, right) => left.document_id.localeCompare(right.document_id))
    .map(({ document_id, title, text }) => ({ document_id, title, text }));
  return sha256(stableJson(normalized));
}
