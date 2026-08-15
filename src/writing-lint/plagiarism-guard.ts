import type { CorpusDocument } from '../style-intelligence/types.js';
import { protectedEntriesForGuard, type ResolvedProtectedTransferIndexes } from '../style-intelligence/protected-transfer.js';
import type { WritingIssue } from '../writing-skills/types.js';
import { authorizedResearchQuoteRecords, type ResolvedAuthorizedQuotes } from './authorized-research-quotes.js';

export interface PlagiarismGuardOptions {
  draft: string;
  corpus: CorpusDocument[];
  authorizedResearchQuotes?: ResolvedAuthorizedQuotes;
  protectedIndexes: ResolvedProtectedTransferIndexes;
  minimumContinuousCharacters?: number;
  ngramOverlapThreshold?: number;
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, '').normalize('NFKC');
}

function isPublicQuotationUse(draft: string, start: number, quote: string): boolean {
  const before = draft.slice(Math.max(0, start - 2), start);
  const after = draft.slice(start + quote.length, start + quote.length + 2);
  if (/[“「『"']\s*$/u.test(before) && /^\s*[”」』"']/u.test(after)) return true;
  const lineStart = draft.lastIndexOf('\n', start - 1) + 1;
  return /^\s*>/u.test(draft.slice(lineStart, start));
}

function removeAuthorizedQuotes(draft: string, quotes: ReturnType<typeof authorizedResearchQuoteRecords>): string {
  const characters = [...draft];
  for (const { quote } of quotes) {
    let cursor = 0;
    while (cursor <= draft.length - quote.length) {
      const start = draft.indexOf(quote, cursor);
      if (start < 0) break;
      if (isPublicQuotationUse(draft, start, quote)) {
        const characterStart = [...draft.slice(0, start)].length;
        const characterLength = [...quote].length;
        characters.splice(characterStart, characterLength, ...Array.from({ length: characterLength }, () => ' '));
      }
      cursor = start + quote.length;
    }
  }
  return characters.join('');
}

function ngrams(value: string, size: number): string[] {
  const characters = [...normalize(value)];
  return Array.from({ length: Math.max(0, characters.length - size + 1) }, (_, index) => characters.slice(index, index + size).join(''));
}

function longestCommonFragment(leftValue: string, rightValue: string, seedSize = 12): string {
  const left = [...normalize(leftValue)];
  const right = [...normalize(rightValue)];
  if (left.length < seedSize || right.length < seedSize) return '';
  const rightSeeds = new Map<string, number[]>();
  for (let index = 0; index <= right.length - seedSize; index += 1) {
    const seed = right.slice(index, index + seedSize).join('');
    rightSeeds.set(seed, [...(rightSeeds.get(seed) ?? []), index]);
  }
  let best = '';
  for (let leftIndex = 0; leftIndex <= left.length - seedSize; leftIndex += 1) {
    const positions = rightSeeds.get(left.slice(leftIndex, leftIndex + seedSize).join('')) ?? [];
    for (const rightIndex of positions) {
      let length = seedSize;
      while (left[leftIndex + length] !== undefined && left[leftIndex + length] === right[rightIndex + length]) length += 1;
      if (length > [...best].length) best = left.slice(leftIndex, leftIndex + length).join('');
    }
  }
  return best;
}

export function guardAgainstPlagiarism(options: PlagiarismGuardOptions): { status: 'pass' | 'blocked'; issues: WritingIssue[] } {
  const authorized = authorizedResearchQuoteRecords(options.authorizedResearchQuotes);
  const checkedDraft = removeAuthorizedQuotes(options.draft, authorized);
  const minimum = options.minimumContinuousCharacters ?? 24;
  const overlapThreshold = options.ngramOverlapThreshold ?? 0.2;
  const draftNgrams = ngrams(checkedDraft, 12);
  const issues: WritingIssue[] = [];
  for (const document of options.corpus) {
    const longest = longestCommonFragment(checkedDraft, document.text);
    const sourceNgrams = new Set(ngrams(document.text, 12));
    const overlap = draftNgrams.length === 0 ? 0 : draftNgrams.filter((value) => sourceNgrams.has(value)).length / draftNgrams.length;
    if (document.rights_status === 'public_reference' && ([...longest].length >= minimum || overlap >= overlapThreshold)) {
      issues.push({
        issue_code: 'public_reference_text_overlap', pattern: 'Unauthorized public-reference overlap', quoted_text: longest.slice(0, 240),
        location: `corpus ${document.document_id}`, severity: 'hard_blocker',
        repair_constraint: 'Re-express the idea and structure from scratch; word substitution is not an acceptable repair.',
        rule_origin: 'plagiarism_guard', source_commit: 'project-v0',
      });
    }
  }
  const protectedEntries = protectedEntriesForGuard(options.protectedIndexes);
  for (const phrase of [...protectedEntries.signaturePhrases, ...protectedEntries.distinctiveShortFragments]) {
    if (phrase.length >= 4 && normalize(checkedDraft).includes(normalize(phrase))) issues.push({
      issue_code: 'signature_phrase_transfer', pattern: 'Signature phrase transfer', quoted_text: phrase, location: 'draft', severity: 'hard_blocker',
      repair_constraint: 'Remove the signature phrase and restate the supported idea in the owner voice.',
      rule_origin: 'plagiarism_guard', source_commit: 'project-v0',
    });
  }
  for (const metaphor of protectedEntries.uniqueMetaphors) {
    if (metaphor.length >= 4 && normalize(checkedDraft).includes(normalize(metaphor))) issues.push({
      issue_code: 'unique_metaphor_transfer', pattern: 'Unique metaphor transfer', quoted_text: metaphor, location: 'draft', severity: 'hard_blocker',
      repair_constraint: 'Remove the source-specific metaphor; do not replace a few words and retry.',
      rule_origin: 'plagiarism_guard', source_commit: 'project-v0',
    });
  }
  for (const entity of protectedEntries.personalExperienceEntities) {
    if (entity.length >= 2 && checkedDraft.includes(entity)) issues.push({
      issue_code: 'personal_experience_transfer', pattern: 'Personal experience entity transfer', quoted_text: entity, location: 'draft', severity: 'hard_blocker',
      repair_constraint: 'Remove the reference author experience or identity; only owner-provided experience may appear.',
      rule_origin: 'plagiarism_guard', source_commit: 'project-v0',
    });
  }
  return { status: issues.some(({ severity }) => severity === 'hard_blocker') ? 'blocked' : 'pass', issues };
}
