import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { importCorpusDocuments } from '../src/style-intelligence/corpus.js';
import { loadAuthorizedResearchQuotes, resolveAuthorizedResearchQuote } from '../src/writing-lint/authorized-research-quotes.js';
import { guardAgainstPlagiarism } from '../src/writing-lint/plagiarism-guard.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
let basePack: Record<string, any>;

beforeAll(async () => { basePack = JSON.parse(await readFile(path.join(process.cwd(), 'data/research-packs/2026-08-14/research-pack.json'), 'utf8')) as Record<string, any>; });
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix)); roots.push(root); return root;
}

function readyPack(): Record<string, any> {
  const pack = structuredClone(basePack);
  pack.decision = 'READY_FOR_WRITING';
  pack.readiness.research_questions_sufficient = true;
  pack.readiness.open_gaps = [];
  return pack;
}

function request(pack: Record<string, any>) {
  const claim = pack.verified_claims[0];
  return { claim_id: claim.claim_id, quote: claim.quote, source_id: claim.source_id, segment_id: claim.segment_id };
}

describe('authorized Research Pack quotations', () => {
  it('does not authorize a fake Claim ID or mismatched quote/source/segment', () => {
    const pack = readyPack();
    expect(() => resolveAuthorizedResearchQuote(pack, { ...request(pack), claim_id: 'claim_fake' })).toThrow('authorized_quote_claim_missing');
    expect(() => resolveAuthorizedResearchQuote(pack, { ...request(pack), quote: 'fabricated' })).toThrow('authorized_quote_text_mismatch');
    expect(() => resolveAuthorizedResearchQuote(pack, { ...request(pack), source_id: 'source_aaaaaaaaaaaa' })).toThrow('authorized_quote_source_mismatch');
    expect(() => resolveAuthorizedResearchQuote(pack, { ...request(pack), segment_id: 'p9999' })).toThrow('authorized_quote_segment_mismatch');
  });

  it('rejects unsupported and incomplete claims and requires explicit partial permission', () => {
    const incomplete = structuredClone(basePack);
    expect(() => resolveAuthorizedResearchQuote(incomplete, request(incomplete))).toThrow('research_pack_not_ready_for_quote_authorization');
    const unsupported = readyPack();
    unsupported.verified_claims[0] = { ...unsupported.verified_claims[0], support_status: 'unsupported', source_id: null, segment_id: null, quote: '', scope_limit: '' };
    expect(() => resolveAuthorizedResearchQuote(unsupported, { ...request(readyPack()), claim_id: unsupported.verified_claims[0].claim_id })).toThrow('authorized_quote_claim_unsupported');
    const partial = readyPack();
    partial.verified_claims[0].support_status = 'partial';
    expect(() => resolveAuthorizedResearchQuote(partial, request(partial))).toThrow('authorized_quote_partial_not_explicitly_allowed');
    expect(resolveAuthorizedResearchQuote(partial, request(partial), { allowPartial: true })).toMatchObject({ kind: 'resolved_authorized_research_quote' });
  });

  it('only exempts an exact READY_FOR_WRITING quote when it is visibly quoted', async () => {
    const root = await temporaryRoot('authorized-quote-');
    const pack = readyPack();
    const packPath = path.join(root, 'pack.json');
    await writeFile(packPath, JSON.stringify(pack));
    const authorizedResearchQuotes = await loadAuthorizedResearchQuotes(packPath);
    const quote = pack.verified_claims[0].quote as string;
    const corpus = [{
      ...(await import('../src/style-intelligence/fixture.js')).buildStyleFixtureDocuments({ profileId: 'quote-ref', profileType: 'reference_technique', rightsStatus: 'public_reference', count: 1 })[0]!,
      text: quote,
    }];
    expect(guardAgainstPlagiarism({ draft: `作者直接说 ${quote}`, corpus, authorizedResearchQuotes }).status).toBe('blocked');
    expect(guardAgainstPlagiarism({ draft: `公开资料写道：“${quote}”`, corpus, authorizedResearchQuotes }).status).toBe('pass');
  });

  it('style:lint provides no exemption without --research-pack and only legal exemptions with it', async () => {
    const root = await temporaryRoot('style-lint-quotes-');
    const corpusRoot = path.join(root, 'corpus');
    const sourcePath = path.join(root, 'quote.txt');
    const draftPath = path.join(root, 'draft.md');
    const packPath = path.join(root, 'pack.json');
    const pack = readyPack();
    const quote = pack.verified_claims[0].quote as string;
    await writeFile(sourcePath, quote);
    await writeFile(draftPath, `公开资料写道：“${quote}”`);
    await writeFile(packPath, JSON.stringify(pack));
    await importCorpusDocuments({
      corpusRoot, sourcePath, profileId: 'quote-reference', profileType: 'reference_technique', rightsStatus: 'public_reference', platform: 'web', contentType: 'analysis',
      source: { creator_id: 'openai', creator_display_name: 'OpenAI', canonical_url: 'https://example.com/source', platform_item_id: 'source-1', published_at: '2026-08-14T00:00:00.000Z' },
      rights: { basis: 'public_reference_analysis', permission_reference: 'public-page-analysis', confirmed_at: '2026-08-15T00:00:00.000Z' },
      modelProcessing: { allowed: false, consent_recorded_at: '2026-08-15T00:00:00.000Z' },
    });
    const args = ['--import', 'tsx', 'scripts/style-lint.ts', '--draft', draftPath, '--corpus-root', corpusRoot];
    await expect(execFileAsync(process.execPath, args, { cwd: process.cwd() })).rejects.toMatchObject({ code: 1 });
    const { stdout } = await execFileAsync(process.execPath, [...args, '--research-pack', packPath], { cwd: process.cwd() });
    expect(JSON.parse(stdout)).toMatchObject({ status: 'pass' });
  });
});
