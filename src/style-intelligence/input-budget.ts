import { sha256, stableJson } from './hash.js';
import type { ModelInputCoverage } from './schemas.js';
import type { CorpusDocument } from './types.js';

export const STYLE_INPUT_LIMITS = {
  maximumDocuments: 30,
  maximumCharactersPerDocument: 12_000,
  maximumTotalCharacters: 240_000,
} as const;

function characterCount(value: string): number { return [...value].length; }

function evenlySpacedDocuments(documents: readonly CorpusDocument[], maximum: number): CorpusDocument[] {
  if (documents.length <= maximum) return [...documents];
  const indices = Array.from({ length: maximum }, (_, index) => Math.round(index * (documents.length - 1) / (maximum - 1)));
  return [...new Set(indices)].map((index) => documents[index]!);
}

export function truncateBeginningMiddleEnd(value: string, maximum: number): string {
  const characters = [...value];
  if (characters.length <= maximum) return value;
  const marker = '\n[… deterministic truncation …]\n';
  const markerCharacters = [...marker];
  const usable = Math.max(0, maximum - markerCharacters.length * 2);
  const beginning = Math.floor(usable * 0.4);
  const middle = Math.floor(usable * 0.3);
  const end = usable - beginning - middle;
  const middleStart = Math.max(beginning, Math.floor((characters.length - middle) / 2));
  return [
    ...characters.slice(0, beginning),
    ...markerCharacters,
    ...characters.slice(middleStart, middleStart + middle),
    ...markerCharacters,
    ...characters.slice(characters.length - end),
  ].join('');
}

export interface StyleInputBudgetResult {
  documents: CorpusDocument[];
  coverage: ModelInputCoverage;
  modelInputHash: string;
}

export function buildStyleInputBudget(documents: readonly CorpusDocument[], processingAllowed = true): StyleInputBudgetResult {
  const sorted = [...documents].sort((left, right) => left.document_id.localeCompare(right.document_id));
  const originalCharacters = sorted.reduce((sum, document) => sum + characterCount(document.text), 0);
  if (!processingAllowed) {
    const coverage: ModelInputCoverage = {
      maximum_documents: STYLE_INPUT_LIMITS.maximumDocuments,
      maximum_chars_per_document: STYLE_INPUT_LIMITS.maximumCharactersPerDocument,
      maximum_total_chars: STYLE_INPUT_LIMITS.maximumTotalCharacters,
      original_documents: sorted.length,
      selected_documents: 0,
      original_chars: originalCharacters,
      supplied_chars: 0,
      coverage_ratio: 0,
      truncation_applied: sorted.length > 0,
      per_document: sorted.map((document) => ({
        document_id: document.document_id,
        original_chars: characterCount(document.text),
        supplied_chars: 0,
        coverage_ratio: 0,
        truncation_applied: true,
      })),
    };
    return { documents: [], coverage, modelInputHash: sha256(stableJson([])) };
  }
  const selected = evenlySpacedDocuments(sorted, STYLE_INPUT_LIMITS.maximumDocuments);
  const perDocumentLimit = selected.length === 0 ? STYLE_INPUT_LIMITS.maximumCharactersPerDocument : Math.min(
    STYLE_INPUT_LIMITS.maximumCharactersPerDocument,
    Math.floor(STYLE_INPUT_LIMITS.maximumTotalCharacters / selected.length),
  );
  const supplied = selected.map((document) => ({ ...document, text: truncateBeginningMiddleEnd(document.text, perDocumentLimit) }));
  const suppliedById = new Map(supplied.map((document) => [document.document_id, document]));
  const perDocument = sorted.map((document) => {
    const original = characterCount(document.text);
    const suppliedCharacters = characterCount(suppliedById.get(document.document_id)?.text ?? '');
    return {
      document_id: document.document_id,
      original_chars: original,
      supplied_chars: suppliedCharacters,
      coverage_ratio: original === 0 ? 1 : Number((suppliedCharacters / original).toFixed(6)),
      truncation_applied: suppliedCharacters < original,
    };
  });
  const suppliedCharacters = perDocument.reduce((sum, item) => sum + item.supplied_chars, 0);
  const coverage: ModelInputCoverage = {
    maximum_documents: STYLE_INPUT_LIMITS.maximumDocuments,
    maximum_chars_per_document: STYLE_INPUT_LIMITS.maximumCharactersPerDocument,
    maximum_total_chars: STYLE_INPUT_LIMITS.maximumTotalCharacters,
    original_documents: sorted.length,
    selected_documents: supplied.length,
    original_chars: originalCharacters,
    supplied_chars: suppliedCharacters,
    coverage_ratio: originalCharacters === 0 ? 1 : Number((suppliedCharacters / originalCharacters).toFixed(6)),
    truncation_applied: supplied.length < sorted.length || perDocument.some((item) => item.truncation_applied),
    per_document: perDocument,
  };
  return {
    documents: supplied,
    coverage,
    modelInputHash: sha256(stableJson(supplied.map(({ document_id, title, text }) => ({ document_id, title, text })))),
  };
}
