import { readFile } from 'node:fs/promises';
import { researchPackSchema, type ResearchPack } from '../research/schemas.js';
import { sha256, stableJson } from '../style-intelligence/hash.js';

interface ResolvedQuoteRecord {
  claim_id: string;
  quote: string;
  source_id: string;
  segment_id: string;
  support_status: 'direct' | 'partial';
  pack_input_hash: string;
}

export interface AuthorizedResearchQuoteRequest {
  claim_id: string;
  quote: string;
  source_id: string;
  segment_id: string;
}

export interface ResolveAuthorizedResearchQuoteOptions { allowPartial?: boolean }
export interface LoadAuthorizedResearchQuoteOptions { allowPartialClaimIds?: readonly string[] }

export interface ResolvedAuthorizedQuote { readonly kind: 'resolved_authorized_research_quote' }
export interface ResolvedAuthorizedQuotes { readonly kind: 'resolved_authorized_research_quotes' }

const resolvedRecords = new WeakMap<object, ResolvedQuoteRecord>();
const resolvedCollections = new WeakMap<object, readonly ResolvedAuthorizedQuote[]>();

function readyPack(input: unknown): ResearchPack {
  const pack = researchPackSchema.parse(input);
  if (pack.status !== 'success' || pack.decision !== 'READY_FOR_WRITING') throw new Error('research_pack_not_ready_for_quote_authorization');
  return pack;
}

function makeResolved(record: ResolvedQuoteRecord): ResolvedAuthorizedQuote {
  const value = Object.freeze({ kind: 'resolved_authorized_research_quote' as const });
  resolvedRecords.set(value, Object.freeze(record));
  return value;
}

export function resolveAuthorizedResearchQuote(
  researchPack: unknown,
  request: AuthorizedResearchQuoteRequest,
  options: ResolveAuthorizedResearchQuoteOptions = {},
): ResolvedAuthorizedQuote {
  const pack = readyPack(researchPack);
  const claim = pack.verified_claims.find(({ claim_id }) => claim_id === request.claim_id);
  if (claim === undefined) throw new Error('authorized_quote_claim_missing');
  if (claim.support_status === 'unsupported') throw new Error('authorized_quote_claim_unsupported');
  if (claim.support_status === 'partial' && options.allowPartial !== true) throw new Error('authorized_quote_partial_not_explicitly_allowed');
  if (claim.quote.trim() === '') throw new Error('authorized_quote_empty');
  if (claim.quote !== request.quote) throw new Error('authorized_quote_text_mismatch');
  if (claim.source_id !== request.source_id) throw new Error('authorized_quote_source_mismatch');
  if (claim.segment_id !== request.segment_id) throw new Error('authorized_quote_segment_mismatch');
  return makeResolved({
    claim_id: claim.claim_id,
    quote: claim.quote,
    source_id: claim.source_id,
    segment_id: claim.segment_id,
    support_status: claim.support_status,
    pack_input_hash: sha256(stableJson({ input_hash: pack.input_hash, run_id: pack.run_id })),
  });
}

export async function loadAuthorizedResearchQuotes(
  filename: string,
  options: LoadAuthorizedResearchQuoteOptions = {},
): Promise<ResolvedAuthorizedQuotes> {
  const pack = readyPack(JSON.parse(await readFile(filename, 'utf8')));
  return resolveAuthorizedResearchQuotes(pack, options);
}

export function resolveAuthorizedResearchQuotes(
  researchPack: unknown,
  options: LoadAuthorizedResearchQuoteOptions = {},
): ResolvedAuthorizedQuotes {
  const pack = readyPack(researchPack);
  const allowedPartial = new Set(options.allowPartialClaimIds ?? []);
  const quotes = pack.verified_claims.flatMap((claim) => {
    if (claim.support_status === 'unsupported') return [];
    if (claim.support_status === 'partial' && !allowedPartial.has(claim.claim_id)) return [];
    return [resolveAuthorizedResearchQuote(pack, {
      claim_id: claim.claim_id,
      quote: claim.quote,
      source_id: claim.source_id!,
      segment_id: claim.segment_id!,
    }, { allowPartial: claim.support_status === 'partial' })];
  });
  const collection = Object.freeze({ kind: 'resolved_authorized_research_quotes' as const });
  resolvedCollections.set(collection, Object.freeze(quotes));
  return collection;
}

export function validateAuthorizedResearchQuote(value: unknown): ResolvedQuoteRecord {
  if (value === null || typeof value !== 'object') throw new Error('unresolved_authorized_research_quote');
  const record = resolvedRecords.get(value);
  if (record === undefined) throw new Error('unresolved_authorized_research_quote');
  if (record.quote.trim() === '' || record.source_id === '' || record.segment_id === '') throw new Error('invalid_resolved_authorized_research_quote');
  return record;
}

export function authorizedResearchQuoteRecords(value: ResolvedAuthorizedQuotes | undefined): readonly ResolvedQuoteRecord[] {
  if (value === undefined) return [];
  if (value === null || typeof value !== 'object') throw new Error('unresolved_authorized_research_quotes');
  const quotes = resolvedCollections.get(value);
  if (quotes === undefined) throw new Error('unresolved_authorized_research_quotes');
  return quotes.map(validateAuthorizedResearchQuote);
}
