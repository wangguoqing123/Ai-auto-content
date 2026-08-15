import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { writingSkillAdaptationMapSchema } from '../src/writing-skills/adaptation-map.js';
import { humanWritingLintRuleIds, projectWritingLintRuleIds } from '../src/writing-lint/human-writing-lint.js';
import { noAiSlopLintRuleIds } from '../src/writing-lint/no-ai-slop-lint.js';

interface ManifestFile {
  path: string;
  sha256: string;
}

interface ManifestSkill {
  id: string;
  version: string | null;
  repository: string;
  commit: string;
  license: string;
  license_file: string;
  adaptation: {
    production_dependency: string;
    python_runtime_required: boolean;
    executable_allowlist: string[];
  };
  files: ManifestFile[];
}

interface Manifest {
  schema_version: number;
  skills: ManifestSkill[];
}

const expectedPins = new Map([
  ['human-writing', {
    commit: '4fda173f3fef7fb808f3eba991eeb2528ea4b189',
    repository: 'https://github.com/KKKKhazix/human-writing',
    version: '1.1.0',
  }],
  ['no-ai-slop', {
    commit: 'd30eddb9e04562234f2070b5ee63ca4649d9a05e',
    repository: 'https://github.com/petergyang/no-ai-slop',
    version: null,
  }],
] as const);

function safeRelativePath(value: string): boolean {
  return value !== '' && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(root, child));
    else if (entry.isFile()) output.push(child);
    else throw new Error(`Unsupported vendored file type: ${child}`);
  }
  return output.sort();
}

async function check(): Promise<void> {
  const root = path.join(process.cwd(), 'third_party', 'writing-skills');
  const manifest = YAML.parse(await readFile(path.join(root, 'manifest.yaml'), 'utf8')) as Manifest;
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.skills)) throw new Error('Invalid writing Skill manifest');
  if (manifest.skills.length !== expectedPins.size) throw new Error('Writing Skill manifest must contain exactly two pins');

  for (const skill of manifest.skills) {
    const expected = expectedPins.get(skill.id as 'human-writing' | 'no-ai-slop');
    if (expected === undefined) throw new Error(`Unknown writing Skill: ${skill.id}`);
    if (skill.commit !== expected.commit || skill.repository !== expected.repository || skill.version !== expected.version) {
      throw new Error(`Pin drift detected for ${skill.id}`);
    }
    if (skill.license !== 'MIT' || !safeRelativePath(skill.license_file)) throw new Error(`Invalid license declaration for ${skill.id}`);
    if (skill.adaptation.production_dependency !== 'vendored_files_only' || skill.adaptation.python_runtime_required) {
      throw new Error(`Invalid runtime adaptation for ${skill.id}`);
    }
    const skillRoot = path.join(root, skill.id);
    const actualFiles = await listFiles(skillRoot);
    const declaredFiles = skill.files.map((file) => file.path).sort();
    if (new Set(declaredFiles).size !== declaredFiles.length || actualFiles.join('\n') !== declaredFiles.join('\n')) {
      throw new Error(`Unlisted or missing vendored files for ${skill.id}`);
    }
    if (!declaredFiles.includes(skill.license_file)) throw new Error(`License is not hash-pinned for ${skill.id}`);
    const executableAllowlist = new Set(skill.adaptation.executable_allowlist);
    for (const file of skill.files) {
      if (!safeRelativePath(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`Invalid file pin for ${skill.id}/${file.path}`);
      const absolute = path.join(skillRoot, file.path);
      const info = await lstat(absolute);
      if (!info.isFile()) throw new Error(`Vendored path is not a regular file: ${skill.id}/${file.path}`);
      const executable = (info.mode & 0o111) !== 0;
      if (executable !== executableAllowlist.has(file.path)) throw new Error(`Unknown executable status: ${skill.id}/${file.path}`);
      const digest = createHash('sha256').update(await readFile(absolute)).digest('hex');
      if (digest !== file.sha256) throw new Error(`SHA-256 drift detected: ${skill.id}/${file.path}`);
    }
    for (const executable of executableAllowlist) {
      if (!declaredFiles.includes(executable)) throw new Error(`Executable allowlist entry is not pinned: ${skill.id}/${executable}`);
    }
  }
  const adaptationMap = writingSkillAdaptationMapSchema.parse(YAML.parse(await readFile(path.join(root, 'adaptation-map.yaml'), 'utf8')));
  const manifestById = new Map(manifest.skills.map((skill) => [skill.id, skill]));
  for (const rule of adaptationMap.rules) {
    if (rule.skill_id === 'project') {
      if (rule.skill_commit !== 'project-v0' || rule.adaptation_mode !== 'project_override') throw new Error(`Project rule masquerades as third-party: ${rule.internal_rule_id}`);
      await lstat(path.join(process.cwd(), rule.source_file));
      continue;
    }
    const skill = manifestById.get(rule.skill_id);
    if (skill === undefined || rule.skill_commit !== skill.commit) throw new Error(`Adaptation pin mismatch: ${rule.internal_rule_id}`);
    if (!skill.files.some(({ path: filename }) => filename === rule.source_file)) throw new Error(`Adaptation source is not hash-pinned: ${rule.internal_rule_id}`);
    await lstat(path.join(root, rule.skill_id, rule.source_file));
  }
  const byId = new Map(adaptationMap.rules.map((rule) => [rule.internal_rule_id, rule]));
  for (const ruleId of humanWritingLintRuleIds) if (byId.get(ruleId)?.skill_id !== 'human-writing') throw new Error(`Missing human-writing adaptation: ${ruleId}`);
  for (const ruleId of noAiSlopLintRuleIds) if (byId.get(ruleId)?.skill_id !== 'no-ai-slop') throw new Error(`Missing no-ai-slop adaptation: ${ruleId}`);
  for (const ruleId of projectWritingLintRuleIds) if (byId.get(ruleId)?.skill_id !== 'project') throw new Error(`Project rule origin mismatch: ${ruleId}`);
  const adapterSources = await Promise.all(['human-writing-adapter.ts', 'no-ai-slop-adapter.ts'].map((filename) => readFile(path.join(process.cwd(), 'src', 'writing-skills', filename), 'utf8')));
  if (adapterSources.some((source) => /third_party|SKILL\.md|eval\.md/u.test(source))) throw new Error('Upstream Skill files must not be loaded as runtime prompts');
  if (adapterSources.some((source) => !source.includes('auditedRuleIds'))) throw new Error('Adapters must expose audited rule mappings');
  console.log(`Writing Skill check passed (${manifest.skills.length} Skills, ${manifest.skills.reduce((sum, skill) => sum + skill.files.length, 0)} files, ${adaptationMap.rules.length} audited rules).`);
}

await check();
