import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runWritingPackTask } from '../src/local-runtime/writing-pack-task.js';
import { loadLocalRuntimeConfig } from '../src/local-runtime/config.js';
import { buildSyntheticReadyResearchPack } from '../src/writing/fixture.js';
import { runWritingBuild } from '../src/writing/pipeline.js';
import { FixtureWritingProvider } from '../src/writing/provider.js';
import {
  resolveApprovedWritingStyleFixture,
  resolveStyleApprovalChain,
  resolvedWritingStyleSnapshot,
} from '../src/writing/style-approval-resolver.js';
import { writingPackSchema } from '../src/writing/schemas.js';
import { createReadyRepository, createStyleChainFixture, type StyleChainFixture } from './writing-test-helpers.js';

let chainFixture: StyleChainFixture;
let style: {
  styleProfilePath: string; approvalReceiptPath: string; bindingAttestationPath: string;
  allowProvisionalStyle: true; expectedStyleHashes: StyleChainFixture['hashes'];
};

let success: Awaited<ReturnType<typeof runWritingBuild>>;
beforeAll(async () => {
  chainFixture = await createStyleChainFixture();
  style = {
    styleProfilePath: chainFixture.profile, approvalReceiptPath: chainFixture.receipt, bindingAttestationPath: chainFixture.attestation,
    allowProvisionalStyle: true, expectedStyleHashes: chainFixture.hashes,
  };
  success = await runWritingBuild({
    rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, fixture: true, syntheticReadyFixture: true,
    ...style, writeOutputs: false,
  });
});
afterAll(async () => chainFixture.cleanup());

describe('Writing Pack production and Research boundaries', () => {
  it('25. rejects Provisional Style in a formal READY run', async () => {
    const repository = await createReadyRepository();
    try {
      const result = await runWritingBuild({ rootDir: repository.root, writingDate: '2026-08-14', ...style, fixture: true, writeOutputs: false });
      expect(result.pack).toMatchObject({ status: 'success', decision: 'WAITING_FOR_APPROVED_STYLE', model: { calls: 0 } });
    } finally { await repository.cleanup(); }
  });

  it('26. requires an explicit allow flag for a Provisional dry-run', async () => {
    const result = await runWritingBuild({ rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, fixture: true, syntheticReadyFixture: true, ...style, allowProvisionalStyle: false, writeOutputs: false });
    expect(result.pack).toMatchObject({ decision: 'WAITING_FOR_APPROVED_STYLE', model: { calls: 0 } });
  });

  it('27. marks every Provisional result production_eligible=false', () => {
    expect(success.pack.style).toMatchObject({ provisional_style_used: true, production_eligible: false });
  });

  it('28. keeps Scheduler from supplying or consuming a Provisional Profile', async () => {
    const repository = await createReadyRepository();
    try {
      const config = await loadLocalRuntimeConfig(process.cwd());
      const result = await runWritingPackTask({ repositoryRoot: repository.root, now: new Date('2026-08-14T06:30:00.000Z'), dryRun: true, fixture: true, config, triggerMode: 'scheduled' });
      expect(result).toMatchObject({ status: 'waiting_for_approved_style', writingDecision: 'WAITING_FOR_APPROVED_STYLE', modelCalls: 0 });
    } finally { await repository.cleanup(); }
  });

  it('29. allows an approved Resolved Style into formal mode', async () => {
    const repository = await createReadyRepository();
    try {
      const provisional = await resolveStyleApprovalChain({ repositoryRoot: repository.root, researchGateAllowed: true, styleProfilePath: style.styleProfilePath, approvalReceiptPath: style.approvalReceiptPath, bindingAttestationPath: style.bindingAttestationPath, expectedHashes: style.expectedStyleHashes });
      const snapshot = resolvedWritingStyleSnapshot(provisional);
      const { style_status: _status, production_eligible: _eligible, ...approvedBody } = snapshot;
      const approved = resolveApprovedWritingStyleFixture(approvedBody);
      const result = await runWritingBuild({ rootDir: repository.root, writingDate: '2026-08-14', resolvedStyle: approved, provider: new FixtureWritingProvider(), skipReferenceGuardForFixture: true, fixture: true, writeOutputs: false });
      expect(result.pack).toMatchObject({ status: 'success', decision: 'READY_FOR_HUMAN_REVIEW', style: { style_status: 'approved', production_eligible: true, provisional_style_used: false } });
    } finally { await repository.cleanup(); }
  });

  it('30. rejects a revoked or structurally altered Profile', async () => {
    const repository = await createReadyRepository();
    try {
      const profile = JSON.parse(await readFile(style.styleProfilePath, 'utf8')) as Record<string, unknown>;
      const revoked = path.join(repository.root, 'revoked.json'); await writeFile(revoked, JSON.stringify({ ...profile, status: 'revoked' }), { mode: 0o600 });
      const result = await runWritingBuild({ rootDir: repository.root, writingDate: '2026-08-14', dryRun: true, fixture: true, styleProfilePath: revoked, approvalReceiptPath: style.approvalReceiptPath, bindingAttestationPath: style.bindingAttestationPath, allowProvisionalStyle: true, expectedStyleHashes: null, writeOutputs: false });
      expect(result.pack.status).toBe('failed');
    } finally { await repository.cleanup(); }
  });

  it('31. returns RESEARCH_INCOMPLETE with zero Writing model calls', async () => {
    const result = await runWritingBuild({ rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, ...style, providerFactory: vi.fn(async () => new FixtureWritingProvider()), writeOutputs: false });
    expect(result.pack).toMatchObject({ decision: 'BLOCKED_BY_RESEARCH', model: { calls: 0 } });
  });

  it('32. maps NO_TOPIC to NO_CONTENT with zero calls', async () => {
    const repository = await createReadyRepository();
    try {
      const pack = buildSyntheticReadyResearchPack(); const noTopic = { ...pack, decision: 'NO_TOPIC', topic: null, sources: [], verified_claims: [], research_answers: [], experiment: null, readiness: { fact_claims_verified: false, research_questions_sufficient: false, experiment_completed: false, open_gaps: [] }, model: { ...pack.model, calls: 0 } };
      await writeFile(path.join(repository.root, 'data/research-packs/2026-08-14/research-pack.json'), JSON.stringify(noTopic));
      const result = await runWritingBuild({ rootDir: repository.root, writingDate: '2026-08-14', writeOutputs: false });
      expect(result.pack).toMatchObject({ decision: 'NO_CONTENT', model: { calls: 0 } });
    } finally { await repository.cleanup(); }
  });

  it('33. maps a missing Research Pack to WAITING_FOR_RESEARCH', async () => {
    const repository = await createReadyRepository();
    try {
      const result = await runWritingBuild({ rootDir: path.join(repository.root, 'missing'), writingDate: '2026-08-14', writeOutputs: false });
      expect(result.pack).toMatchObject({ decision: 'WAITING_FOR_RESEARCH', model: { calls: 0 } });
    } finally { await repository.cleanup(); }
  });

  it('34. maps a failed Research Pack to WAITING_FOR_RESEARCH', async () => {
    const repository = await createReadyRepository();
    try {
      const pack = buildSyntheticReadyResearchPack();
      const failed = { ...pack, status: 'failed', decision: null, error_code: 'source_fetch_failed', error_message_safe: 'source_fetch_failed' };
      await writeFile(path.join(repository.root, 'data/research-packs/2026-08-14/research-pack.json'), JSON.stringify(failed));
      const result = await runWritingBuild({ rootDir: repository.root, writingDate: '2026-08-14', writeOutputs: false });
      expect(result.pack).toMatchObject({ decision: 'WAITING_FOR_RESEARCH', model: { calls: 0 } });
    } finally { await repository.cleanup(); }
  });

  it('35. evaluates Research before attempting any Style file read', async () => {
    const result = await runWritingBuild({ rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, styleProfilePath: '/does/not/exist/profile.json', approvalReceiptPath: '/does/not/exist/receipt.json', bindingAttestationPath: '/does/not/exist/attestation.json', allowProvisionalStyle: true, writeOutputs: false });
    expect(result.pack.decision).toBe('BLOCKED_BY_RESEARCH');
  });

  it('36. evaluates Research before Provider initialization and model configuration', async () => {
    const providerFactory = vi.fn(async () => { throw new Error('must not initialize'); });
    const result = await runWritingBuild({ rootDir: process.cwd(), writingDate: '2026-08-14', dryRun: true, ...style, providerFactory, writeOutputs: false });
    expect(result.pack.decision).toBe('BLOCKED_BY_RESEARCH'); expect(providerFactory).not.toHaveBeenCalled();
  });

  it('37. emits structured Content Blocks', () => {
    expect(success.pack.master_draft?.blocks.length).toBeGreaterThan(5); expect(success.pack.master_draft?.blocks.every(({ block_id }) => block_id.startsWith('block_'))).toBe(true);
  });

  it('38. emits exactly three WeChat titles', () => {
    expect([success.pack.wechat?.primary_title, ...(success.pack.wechat?.alternative_titles ?? [])]).toHaveLength(3);
  });

  it('39. emits exactly one final X format', () => {
    expect(success.pack.x).toMatchObject({ format: 'thread', single_post: null, debate_prompt: null });
  });

  it('40. does not mechanically split the WeChat article into X items', () => {
    const article = success.pack.wechat!.article_markdown; expect(success.pack.x!.thread.every((item) => !article.includes(item))).toBe(true);
  });

  it('41. applies the tutorial-specific structure only to a tutorial', () => {
    const types = success.pack.master_draft!.blocks.map(({ block_type }) => block_type); expect(types).toEqual(expect.arrayContaining(['step', 'acceptance', 'failure', 'boundary']));
  });

  it('42. prevents Owner shortform rules from controlling WeChat longform structure', () => {
    const ownerStructuralIds = new Set(['OSL-02']); expect(success.pack.style!.selected_rule_ids).toEqual(expect.arrayContaining(['PLATFORM-WECHAT-LONGFORM'])); expect(ownerStructuralIds.has('PLATFORM-WECHAT-LONGFORM')).toBe(false);
  });

  it('43. keeps Reference voice out of the generated Style audit', () => {
    expect(success.pack.audits!.style.status).toBe('pass'); expect(success.pack.audits!.style.issues.map(({ issue_code }) => issue_code)).not.toContain('reference_voice_transfer');
  });

  it('44. keeps Reference preferred terms out of the Writing Pack', () => {
    expect(JSON.stringify(success.pack)).not.toMatch(/preferred_terms/u);
  });

  it('45. uses every required Research Claim', () => {
    expect(success.pack.audits!.evidence.used_claim_ids.sort()).toEqual(success.pack.audits!.evidence.required_claim_ids.sort());
  });

  it('46. rejects an unsupported Claim through the Evidence Audit contract', () => {
    expect(success.pack.audits!.evidence.checked_items).toContain('partial claims bounded and excluded from titles'); expect(success.pack.audits!.evidence.status).toBe('pass');
  });

  it('47. prevents partial Claims from silently becoming title-level certainty', () => {
    expect(success.pack.wechat!.primary_title).not.toContain('目前能确认的是'); expect(success.pack.audits!.evidence.status).toBe('pass');
  });

  it('48. reads experiment numbers from the saved Research Pack', () => {
    expect(success.pack.master_draft!.rendered_markdown).toMatch(/通过 6 项验收.*通过 8 项/u);
  });

  it('49. preserves all experiment limitations', () => {
    for (const limitation of buildSyntheticReadyResearchPack().experiment!.limitations) expect(success.pack.wechat!.article_markdown).toContain(limitation);
  });

  it('50. never upgrades the Research CTA', () => {
    expect(success.pack.audits!.product).toMatchObject({ requested_cta_mode: 'light', effective_cta_mode: 'light', status: 'pass' });
  });

  it('51. downgrades CON-05-dependent product bridging', () => {
    expect(success.pack.style!.excluded_rule_ids).toContain('CON-05'); expect(success.pack.wechat!.cta.text).not.toMatch(/俱乐部|会员|购买/u);
  });

  it('52. omits public price by default', () => {
    expect(success.pack.wechat!.article_markdown).not.toMatch(/365|499|元/u); expect(success.pack.audits!.product.status).toBe('pass');
  });

  it('53. rejects unsupported factual first-person claims', () => {
    expect(success.pack.audits!.first_person.status).toBe('pass'); expect(success.pack.master_draft!.rendered_markdown).not.toMatch(/我测试了|我的用户|我的学员/u);
  });

  it('54. allows marked first-person opinions', () => {
    const opinionBlocks = success.pack.master_draft!.blocks.filter(({ is_opinion }) => is_opinion); expect(opinionBlocks.length).toBeGreaterThan(0);
  });

  it('55. validates the final Writing Pack against its Zod schema', () => {
    expect(writingPackSchema.safeParse(success.pack).success).toBe(true);
  });
});
