import type { ArticleType } from '../style-intelligence/schemas.js';

export const writingIssueSeverities = ['hard_blocker', 'blocking_style_issue', 'warning', 'profile_preference'] as const;
export type WritingIssueSeverity = typeof writingIssueSeverities[number];

export interface WritingIssue {
  issue_code: string;
  pattern: string;
  quoted_text: string;
  location: string;
  severity: WritingIssueSeverity;
  repair_constraint: string;
}

export interface WritingContext {
  article_type: ArticleType;
  material_count: number;
  factual_mode: 'nonfiction' | 'fiction' | 'mixed';
}
