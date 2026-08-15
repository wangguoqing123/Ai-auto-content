import type { WritingIssue } from './types.js';
import { auditedRuleIds } from './adaptation-map.js';

export interface DetectOnlyReview {
  mode: 'detect_only';
  issues: WritingIssue[];
  output_fields: readonly ['issue_code', 'pattern', 'quoted_text', 'location', 'severity', 'repair_constraint', 'rule_origin', 'source_commit'];
  audited_rule_ids: string[];
  permits_full_text_rewrite: false;
  permits_new_facts_examples_or_opinions: false;
}

export function adaptNoAiSlopReview(issues: WritingIssue[]): DetectOnlyReview {
  return {
    mode: 'detect_only',
    issues,
    output_fields: ['issue_code', 'pattern', 'quoted_text', 'location', 'severity', 'repair_constraint', 'rule_origin', 'source_commit'],
    audited_rule_ids: auditedRuleIds('no-ai-slop'),
    permits_full_text_rewrite: false,
    permits_new_facts_examples_or_opinions: false,
  };
}
