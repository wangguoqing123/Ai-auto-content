import { chmod, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '../src/style-intelligence/hash.js';
import {
  currentApprovalHashes,
  resolveStyleApprovalChain,
  resolvedWritingStyleSnapshot,
  rulesForWriter,
} from '../src/writing/style-approval-resolver.js';
import { buildWritingStyleRecipes } from '../src/writing/style-recipe.js';
import { loadWritingIntelligenceConfig } from '../src/writing/config.js';
import { createStyleChainFixture, readJson, writePrivateJson, type StyleChainFixture } from './writing-test-helpers.js';

const fixtures: StyleChainFixture[] = [];
afterEach(async () => Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup())));

async function chain() { const value = await createStyleChainFixture(); fixtures.push(value); return value; }
function options(fixture: StyleChainFixture, expectedHashes: typeof currentApprovalHashes | null = fixture.hashes) {
  return { repositoryRoot: process.cwd(), researchGateAllowed: true as const, styleProfilePath: fixture.profile, approvalReceiptPath: fixture.receipt, bindingAttestationPath: fixture.attestation, expectedHashes };
}

describe('Writing Style Approval Chain Resolver', () => {
  it('1. accepts a valid Receipt v2 that binds the Profile directly', async () => {
    const fixture = await chain();
    const receipt = await readJson(fixture.receipt);
    await writePrivateJson(fixture.receipt, { ...receipt, version: 2, provisional_profile_sha256: sha256(await readFile(fixture.profile)) });
    const resolved = await resolveStyleApprovalChain(options(fixture, null));
    expect(resolvedWritingStyleSnapshot(resolved).approval_chain_status).toBe('valid_v2_receipt');
  });

  it('2. accepts the valid legacy Receipt plus Binding Attestation', async () => {
    const resolved = await resolveStyleApprovalChain(options(await chain()));
    expect(resolvedWritingStyleSnapshot(resolved).approval_chain_status).toBe('valid_legacy_receipt_with_binding_attestation');
  });

  it('3. rejects a Receipt hash mismatch', async () => {
    const fixture = await chain(); await writeFile(fixture.receipt, `${await readFile(fixture.receipt, 'utf8')}\n`, { mode: 0o600 });
    await expect(resolveStyleApprovalChain(options(fixture))).rejects.toMatchObject({ code: 'style_approval_chain_invalid' });
  });

  it('4. rejects a Provisional Profile hash mismatch', async () => {
    const fixture = await chain(); await writeFile(fixture.profile, `${await readFile(fixture.profile, 'utf8')}\n`, { mode: 0o600 });
    await expect(resolveStyleApprovalChain(options(fixture))).rejects.toMatchObject({ code: 'style_approval_chain_invalid' });
  });

  it('5. rejects an Approval Summary hash mismatch', async () => {
    const fixture = await chain(); await writeFile(fixture.summary, `${await readFile(fixture.summary, 'utf8')}\n`, { mode: 0o600 });
    await expect(resolveStyleApprovalChain(options(fixture))).rejects.toMatchObject({ code: 'style_approval_chain_invalid' });
  });

  it('6. rejects a Decision Set hash mismatch', async () => {
    const fixture = await chain(); const attestation = await readJson(fixture.attestation); attestation.decision_set_sha256 = 'a'.repeat(64); await writePrivateJson(fixture.attestation, attestation);
    await expect(resolveStyleApprovalChain(options(fixture, null))).rejects.toMatchObject({ code: 'style_approval_chain_invalid' });
  });

  it('7. rejects a Decision Count mismatch', async () => {
    const fixture = await chain(); const attestation = await readJson(fixture.attestation); attestation.decision_count = 27; await writePrivateJson(fixture.attestation, attestation);
    await expect(resolveStyleApprovalChain(options(fixture, null))).rejects.toMatchObject({ code: 'style_approval_chain_invalid' });
  });

  it('8. rejects an Owner base Profile hash mismatch', async () => {
    const fixture = await chain(); const attestation = await readJson(fixture.attestation); attestation.owner_profile_hashes[0].sha256 = 'c'.repeat(64); await writePrivateJson(fixture.attestation, attestation);
    await expect(resolveStyleApprovalChain(options(fixture, null))).rejects.toMatchObject({ code: 'style_approval_chain_invalid' });
  });

  it('9. rejects a Reference base Profile hash mismatch', async () => {
    const fixture = await chain(); const attestation = await readJson(fixture.attestation); attestation.reference_profile_hashes[0].sha256 = 'c'.repeat(64); await writePrivateJson(fixture.attestation, attestation);
    await expect(resolveStyleApprovalChain(options(fixture, null))).rejects.toMatchObject({ code: 'style_approval_chain_invalid' });
  });

  it('10. rejects a symlinked Binding Attestation', async () => {
    const fixture = await chain(); const target = `${fixture.attestation}.target`; await writeFile(target, await readFile(fixture.attestation), { mode: 0o600 }); await unlink(fixture.attestation); await symlink(target, fixture.attestation);
    await expect(resolveStyleApprovalChain(options(fixture, null))).rejects.toBeTruthy();
  });

  it('11. rejects insecure Style file permissions', async () => {
    const fixture = await chain(); await chmod(fixture.receipt, 0o644);
    await expect(resolveStyleApprovalChain(options(fixture, null))).rejects.toMatchObject({ code: 'style_approval_chain_invalid' });
  });

  it('12. rejects semantic_changes=true', async () => {
    const fixture = await chain(); const attestation = await readJson(fixture.attestation); attestation.semantic_changes = true; await writePrivateJson(fixture.attestation, attestation);
    await expect(resolveStyleApprovalChain(options(fixture, null))).rejects.toMatchObject({ code: 'style_approval_chain_invalid' });
  });

  it('13. keeps OCV-09 out of active rules', async () => {
    const snapshot = resolvedWritingStyleSnapshot(await resolveStyleApprovalChain(options(await chain())));
    expect(snapshot.excluded_rule_ids).toContain('OCV-09'); expect(snapshot.active_rules.map(({ rule_id }) => rule_id)).not.toContain('OCV-09');
  });

  it('14. keeps CON-05 out of active rules', async () => {
    const snapshot = resolvedWritingStyleSnapshot(await resolveStyleApprovalChain(options(await chain())));
    expect(snapshot.excluded_rule_ids).toContain('CON-05'); expect(snapshot.active_rules.map(({ rule_id }) => rule_id)).not.toContain('CON-05');
  });

  it('15. records OCV-10 only as deleted and never as a Writer rule', async () => {
    const style = await resolveStyleApprovalChain(options(await chain())); const snapshot = resolvedWritingStyleSnapshot(style);
    expect(snapshot.deleted_rule_ids).toEqual(['OCV-10']); expect(rulesForWriter(style, 'wechat', 'tutorial').map(({ rule_id }) => rule_id)).not.toContain('OCV-10');
  });

  it('16. excludes every pending rule from Writer input', async () => {
    const style = await resolveStyleApprovalChain(options(await chain()));
    expect(rulesForWriter(style, 'wechat', 'tutorial').map(({ rule_id }) => rule_id)).not.toEqual(expect.arrayContaining(['OCV-09', 'CON-05']));
  });

  it('17. excludes every deleted rule from Writer input', async () => {
    const style = await resolveStyleApprovalChain(options(await chain()));
    expect(rulesForWriter(style, 'x', 'opinion').map(({ rule_id }) => rule_id)).not.toContain('OCV-10');
  });

  it('18. applies scoped rules only to their declared platform and article type', async () => {
    const style = await resolveStyleApprovalChain(options(await chain()));
    expect(rulesForWriter(style, 'wechat', 'tutorial').map(({ rule_id }) => rule_id)).toContain('OCV-06');
    expect(rulesForWriter(style, 'x', 'checklist').map(({ rule_id }) => rule_id)).not.toContain('OCV-06');
  });

  it('19. gives Writer only the bounded selected rule set, not raw calibration rules', async () => {
    const style = await resolveStyleApprovalChain(options(await chain())); const config = await loadWritingIntelligenceConfig();
    const recipes = buildWritingStyleRecipes(style, 'tutorial', config);
    expect(recipes.selected_rule_ids.length).toBeLessThan(30); expect(recipes.selected_rule_ids.length).toBeLessThan(210);
  });

  it('20. resolves the exact current decision set hash', async () => {
    const snapshot = resolvedWritingStyleSnapshot(await resolveStyleApprovalChain(options(await chain())));
    expect(snapshot.decision_set_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(currentApprovalHashes.decisionSet).toBe('6bafa8b40be7e6753f9191b3bf5fa35801f65c2e62671a1706ca02e338b86678');
  });

  it('21. exposes the approved Owner shortform proxy scope without claiming native platform fidelity', async () => {
    const snapshot = resolvedWritingStyleSnapshot(await resolveStyleApprovalChain(options(await chain())));
    expect(snapshot).toMatchObject({ style_scope: 'owner_shortform_social_proxy', platform_fidelity: 'proxy', confidence_label: 'medium' });
  });

  it('22. keeps Reference rules out of X Recipe', async () => {
    const style = await resolveStyleApprovalChain(options(await chain())); const recipes = buildWritingStyleRecipes(style, 'opinion', await loadWritingIntelligenceConfig());
    expect(recipes.x.source_weights).toEqual({ owner: 1, reference: 0, platform: 0 }); expect(recipes.x.selected_rules.every(({ source_role }) => !['reference', 'platform'].includes(source_role))).toBe(true);
  });

  it('23. assigns exact WeChat source weights', async () => {
    const style = await resolveStyleApprovalChain(options(await chain())); const recipes = buildWritingStyleRecipes(style, 'tutorial', await loadWritingIntelligenceConfig());
    expect(recipes.wechat.source_weights).toEqual({ owner: 0.65, reference: 0.2, platform: 0.15 });
  });

  it('24. never selects Reference voice or lexical rules', async () => {
    const style = await resolveStyleApprovalChain(options(await chain())); const recipes = buildWritingStyleRecipes(style, 'tutorial', await loadWritingIntelligenceConfig());
    expect(recipes.wechat.selected_rules.filter(({ source_role }) => source_role === 'reference').every(({ category }) => !['voice', 'lexical', 'first_person'].includes(category))).toBe(true);
  });
});
