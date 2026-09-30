import { chmod, lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertNoSymlinkComponents } from '../style-intelligence/safe-local-path.js';
import type { WritingPack } from './schemas.js';

async function secureDirectory(directory: string): Promise<void> {
  await assertNoSymlinkComponents(path.dirname(directory), true);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('writing_output_directory_invalid');
  await chmod(directory, 0o700);
}

async function privateWrite(filename: string, content: string): Promise<void> {
  await writeFile(filename, content, { encoding: 'utf8', mode: 0o600 });
  await chmod(filename, 0o600);
}

const labels = `synthetic_fixture=true
not_for_publication=true
provisional_style_used=true
production_eligible=false`;

export async function writeTemporaryWritingPack(pack: WritingPack): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ai-auto-content-writing-'));
  await chmod(directory, 0o700);
  await privateWrite(path.join(directory, 'writing-pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
  return directory;
}

export async function writeSyntheticReviewPack(pack: WritingPack, directory: string): Promise<string> {
  if (pack.decision !== 'READY_FOR_HUMAN_REVIEW' || pack.master_draft === null || pack.wechat === null || pack.x === null || pack.audits === null || pack.style === null) throw new Error('review_pack_requires_ready_writing_pack');
  await secureDirectory(directory);
  const xText = pack.x.format === 'thread' ? pack.x.thread.map((item, index) => `${index + 1}/${pack.x!.thread.length}\n${item}`).join('\n\n')
    : pack.x.single_post ?? pack.x.debate_prompt ?? '';
  await Promise.all([
    privateWrite(path.join(directory, 'wechat-draft.md'), `${labels}\n\n${pack.wechat.article_markdown}\n`),
    privateWrite(path.join(directory, 'x-draft.md'), `${labels}\n\nformat=${pack.x.format}\n\n${xText}\n`),
    privateWrite(path.join(directory, 'master-draft.md'), `${labels}\n\n${pack.master_draft.rendered_markdown}\n`),
    privateWrite(path.join(directory, 'style-audit-summary.md'), `${labels}\n\n# Style audit\n\n- status: ${pack.audits.style.status}\n- approval_chain_status: ${pack.style.approval_chain_status}\n- owner_profile_scope: ${pack.style.owner_profile_scope}\n- platform_fidelity: ${pack.style.platform_fidelity}\n- selected_rules: ${pack.style.selected_rule_ids.length}\n- issues: ${pack.audits.style.issues.length}\n`),
    privateWrite(path.join(directory, 'evidence-audit-summary.md'), `${labels}\n\n# Evidence audit\n\n- status: ${pack.audits.evidence.status}\n- required_claims: ${pack.audits.evidence.required_claim_ids.length}\n- used_claims: ${pack.audits.evidence.used_claim_ids.length}\n- experiment_status: ${pack.audits.experiment.status}\n- product_status: ${pack.audits.product.status}\n- first_person_status: ${pack.audits.first_person.status}\n`),
    privateWrite(path.join(directory, 'approval-chain-summary.md'), `${labels}\n\n# Approval chain\n\n- status: ${pack.style.approval_chain_status}\n- receipt_sha256: ${pack.style.receipt_sha256}\n- provisional_profile_sha256: ${pack.style.profile_hashes.provisional}\n- decision_set_sha256: ${pack.style.decision_set_sha256}\n- production_eligible: false\n`),
    privateWrite(path.join(directory, 'writing-pack-summary.json'), `${JSON.stringify({
      synthetic_fixture: true, not_for_publication: true, provisional_style_used: true, production_eligible: false,
      run_id: pack.run_id, decision: pack.decision, style: pack.style, human_gate: pack.human_gate,
      model: pack.model, wechat_chinese_character_count: pack.wechat.chinese_character_count,
      x_format: pack.x.format, x_item_count: pack.x.format === 'thread' ? pack.x.thread.length : 1,
      audit_statuses: Object.fromEntries(['evidence', 'experiment', 'product', 'first_person', 'style', 'plagiarism'].map((key) => [key, (pack.audits as unknown as Record<string, { status: string }>)[key]!.status])),
    }, null, 2)}\n`),
  ]);
  return directory;
}

export async function writeProductionWritingPack(rootDir: string, pack: WritingPack): Promise<string[]> {
  if (pack.style?.production_eligible !== true || pack.style.provisional_style_used || pack.decision !== 'READY_FOR_HUMAN_REVIEW' || pack.master_draft === null || pack.wechat === null || pack.x === null) throw new Error('production_writing_requires_approved_style');
  const root = path.join(rootDir, 'data', 'writing-packs', pack.writing_date);
  const wechat = path.join(root, 'wechat');
  const x = path.join(root, 'x');
  const runs = path.join(rootDir, 'data', 'writing-runs');
  const reports = path.join(rootDir, 'reports', 'writing');
  for (const directory of [root, wechat, x, runs, reports]) await mkdir(directory, { recursive: true });
  const files: Array<[string, string]> = [
    [path.join(root, 'writing-pack.json'), `${JSON.stringify(pack, null, 2)}\n`],
    [path.join(root, 'master-draft.md'), `${pack.master_draft.rendered_markdown}\n`],
    [path.join(wechat, 'article.md'), `${pack.wechat.article_markdown}\n`],
    [path.join(wechat, 'metadata.json'), `${JSON.stringify({ primary_title: pack.wechat.primary_title, alternative_titles: pack.wechat.alternative_titles, abstract: pack.wechat.abstract, source_notes: pack.wechat.source_notes, visual_slots: pack.wechat.visual_slots }, null, 2)}\n`],
    [path.join(x, 'package.json'), `${JSON.stringify(pack.x, null, 2)}\n`],
    [path.join(runs, `${pack.run_id}.json`), `${JSON.stringify(pack, null, 2)}\n`],
    [path.join(reports, `${pack.writing_date}.md`), `# Writing Pack ${pack.writing_date}\n\n- decision: ${pack.decision}\n- human_gate: unreviewed\n- automated_publish_allowed: false\n`],
  ];
  await Promise.all(files.map(([filename, content]) => writeFile(filename, content, 'utf8')));
  return files.map(([filename]) => filename);
}
