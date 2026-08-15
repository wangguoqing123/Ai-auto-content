import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { writingIssueSeverities } from './types.js';

export const writingSkillAdaptationEntrySchema = z.strictObject({
  internal_rule_id: z.string().regex(/^[a-z][a-z0-9_]{2,100}$/),
  skill_id: z.enum(['human-writing', 'no-ai-slop', 'project']),
  skill_commit: z.string().min(1).max(100),
  source_file: z.string().min(1).max(500),
  source_section: z.string().min(1).max(500),
  adaptation_mode: z.enum(['direct', 'contextualized', 'project_override']),
  severity: z.enum(writingIssueSeverities),
  notes: z.string().min(1).max(2_000),
});

export const writingSkillAdaptationMapSchema = z.strictObject({
  schema_version: z.literal(1),
  rules: z.array(writingSkillAdaptationEntrySchema).min(1).max(200),
}).superRefine((map, context) => {
  const ids = new Set<string>();
  for (const [index, rule] of map.rules.entries()) {
    if (ids.has(rule.internal_rule_id)) context.addIssue({ code: 'custom', path: ['rules', index, 'internal_rule_id'], message: 'Duplicate internal_rule_id' });
    ids.add(rule.internal_rule_id);
    if (rule.skill_id === 'project' && rule.adaptation_mode !== 'project_override') context.addIssue({ code: 'custom', path: ['rules', index, 'adaptation_mode'], message: 'Project rules must be marked project_override' });
    if (rule.skill_id !== 'project' && rule.adaptation_mode === 'project_override') context.addIssue({ code: 'custom', path: ['rules', index, 'adaptation_mode'], message: 'Third-party rules cannot masquerade as project overrides' });
  }
});

export type WritingSkillAdaptationMap = z.infer<typeof writingSkillAdaptationMapSchema>;

let cached: WritingSkillAdaptationMap | undefined;
export function loadWritingSkillAdaptationMap(repositoryRoot = process.cwd()): WritingSkillAdaptationMap {
  cached ??= writingSkillAdaptationMapSchema.parse(YAML.parse(readFileSync(path.join(repositoryRoot, 'third_party', 'writing-skills', 'adaptation-map.yaml'), 'utf8')));
  return cached;
}

export function auditedRuleIds(skillId: 'human-writing' | 'no-ai-slop'): string[] {
  return loadWritingSkillAdaptationMap().rules.filter(({ skill_id }) => skill_id === skillId).map(({ internal_rule_id }) => internal_rule_id);
}
