import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { writingSkillManifest } from '../src/writing-skills/manifest.js';
import { writingSkillAdaptationMapSchema } from '../src/writing-skills/adaptation-map.js';

const execFileAsync = promisify(execFile);

describe('vendored writing Skills', () => {
  it('pins both requested upstream commits and human-writing 1.1.0', async () => {
    const manifest = YAML.parse(await readFile(path.join(process.cwd(), 'third_party/writing-skills/manifest.yaml'), 'utf8')) as { skills: Array<Record<string, unknown>> };
    expect(manifest.skills).toMatchObject([
      { id: 'human-writing', version: '1.1.0', commit: writingSkillManifest.humanWriting.commit, license: 'MIT' },
      { id: 'no-ai-slop', commit: writingSkillManifest.noAiSlop.commit, license: 'MIT' },
    ]);
  });

  it('retains both MIT license files', async () => {
    for (const skill of ['human-writing', 'no-ai-slop']) {
      const license = await readFile(path.join(process.cwd(), 'third_party/writing-skills', skill, 'LICENSE'), 'utf8');
      expect(license).toMatch(/MIT License/u);
    }
  });

  it('passes local file, SHA-256, pin, license, and executable checks', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', 'scripts/writing-skills-check.ts'], { cwd: process.cwd() });
    expect(stdout).toContain('Writing Skill check passed (2 Skills, 14 files, 23 audited rules).');
  });

  it('maps every adapted rule to a pinned Skill commit or explicit project override', async () => {
    const map = writingSkillAdaptationMapSchema.parse(YAML.parse(await readFile(path.join(process.cwd(), 'third_party/writing-skills/adaptation-map.yaml'), 'utf8')));
    expect(new Set(map.rules.map(({ internal_rule_id }) => internal_rule_id)).size).toBe(map.rules.length);
    expect(map.rules.find(({ internal_rule_id }) => internal_rule_id === 'binary_contrast')).toMatchObject({ skill_id: 'no-ai-slop', skill_commit: writingSkillManifest.noAiSlop.commit });
    expect(map.rules.find(({ internal_rule_id }) => internal_rule_id === 'reversal_rhetoric')).toMatchObject({ skill_id: 'human-writing', skill_commit: writingSkillManifest.humanWriting.commit });
    expect(map.rules.find(({ internal_rule_id }) => internal_rule_id === 'business_jargon')).toMatchObject({ skill_id: 'project', adaptation_mode: 'project_override' });
  });

  it('does not download writing Skills in the package script or PR CI', async () => {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const workflow = await readFile(path.join(process.cwd(), '.github/workflows/pr-validation.yml'), 'utf8');
    expect(packageJson.scripts['writing-skills:check']).toBe('tsx scripts/writing-skills-check.ts');
    expect(`${packageJson.scripts['writing-skills:check']}\n${workflow}`).not.toMatch(/git clone|curl\s|wget\s|human-writing\.git|no-ai-slop\.git/iu);
  });

  it('does not depend on a globally installed writing Skill', async () => {
    await expect(access(path.join(process.cwd(), 'third_party/writing-skills/human-writing/SKILL.md'))).resolves.toBeUndefined();
    await expect(access(path.join(process.cwd(), 'third_party/writing-skills/no-ai-slop/SKILL.md'))).resolves.toBeUndefined();
  });

  it('keeps the PR fixture offline and outside writing, image, browser, and publishing paths', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', 'scripts/style-distill.ts', '--fixture'], { cwd: process.cwd() });
    expect(JSON.parse(stdout)).toMatchObject({ provider: 'fixture', model_calls: 1, wrote_local_profile: false });
    const scripts = await Promise.all(['style-distill.ts', 'style-lint.ts'].map((filename) => readFile(path.join(process.cwd(), 'scripts', filename), 'utf8')));
    expect(scripts.join('\n')).not.toMatch(/collectors\/opencli|browser-pipeline|image_gen|publish-package|local-runtime\/scheduler|launchd/iu);
  });
});
