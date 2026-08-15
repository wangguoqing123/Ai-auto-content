import type { WritingIssue } from '../writing-skills/types.js';

export interface WritingLintReport {
  status: 'pass' | 'blocked';
  issues: WritingIssue[];
  counts: Record<WritingIssue['severity'], number>;
}

export function buildWritingLintReport(issues: WritingIssue[]): WritingLintReport {
  const counts = { hard_blocker: 0, blocking_style_issue: 0, warning: 0, profile_preference: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return { status: counts.hard_blocker + counts.blocking_style_issue > 0 ? 'blocked' : 'pass', issues, counts };
}
