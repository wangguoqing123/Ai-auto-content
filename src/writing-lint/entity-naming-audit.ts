import { z } from 'zod';
import type { WritingIssue } from '../writing-skills/types.js';

export const entityNamingAuditSchema = z.strictObject({
  entity_id: z.string().trim().min(1).max(300),
  labels_used: z.array(z.string().trim().min(1).max(300)).min(1).max(30),
  locations: z.array(z.string().trim().min(1).max(300)).min(1).max(30),
  is_same_referent: z.boolean(),
  issue: z.enum(['synonym_cycling']).nullable(),
}).superRefine((audit, context) => {
  if (audit.labels_used.length !== audit.locations.length) context.addIssue({ code: 'custom', path: ['locations'], message: 'Each label requires a location' });
  const blocking = audit.is_same_referent && new Set(audit.labels_used).size > 1;
  if (blocking !== (audit.issue === 'synonym_cycling')) context.addIssue({ code: 'custom', path: ['issue'], message: 'Only a confirmed same referent renamed across blocks can be synonym_cycling' });
});

export type EntityNamingAudit = z.infer<typeof entityNamingAuditSchema>;

export function buildEntityNamingAudit(input: Omit<EntityNamingAudit, 'issue'>): EntityNamingAudit {
  return entityNamingAuditSchema.parse({
    ...input,
    issue: input.is_same_referent && new Set(input.labels_used).size > 1 ? 'synonym_cycling' : null,
  });
}

export function entityNamingIssue(audit: EntityNamingAudit): WritingIssue | null {
  const parsed = entityNamingAuditSchema.parse(audit);
  if (parsed.issue === null) return null;
  return {
    issue_code: parsed.issue,
    pattern: '结构化实体在相邻内容块中无原因改名',
    quoted_text: parsed.labels_used.join(' / '),
    location: parsed.locations.join(', '),
    severity: 'blocking_style_issue',
    repair_constraint: '同一个 entity_id 沿用同一个清楚称呼。',
    rule_origin: 'project',
    source_commit: 'project-v0',
  };
}
