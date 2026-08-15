import type { WritingIssue } from './types.js';

export interface DetectOnlyReview {
  mode: 'detect_only';
  issues: WritingIssue[];
  output_fields: readonly ['issue_code', 'pattern', 'quoted_text', 'location', 'severity', 'repair_constraint'];
  permits_full_text_rewrite: false;
  permits_new_facts_examples_or_opinions: false;
}

export function adaptNoAiSlopReview(issues: WritingIssue[]): DetectOnlyReview {
  return {
    mode: 'detect_only',
    issues,
    output_fields: ['issue_code', 'pattern', 'quoted_text', 'location', 'severity', 'repair_constraint'],
    permits_full_text_rewrite: false,
    permits_new_facts_examples_or_opinions: false,
  };
}
