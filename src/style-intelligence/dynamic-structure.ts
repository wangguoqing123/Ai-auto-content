import type { ArticleType } from './schemas.js';

export const articleStructures: Record<ArticleType, readonly string[]> = {
  tutorial: ['task', 'blocker', 'steps', 'deliverable', 'acceptance', 'failure_handling'],
  analysis: ['judgment', 'evidence', 'mechanism', 'user_impact', 'boundary', 'action'],
  case_breakdown: ['background', 'key_choices', 'process', 'result', 'reusable', 'not_reusable'],
  opinion: ['controversy', 'judgment', 'basis', 'strongest_counterargument', 'boundary', 'next_step'],
  checklist: ['scenario', 'criteria', 'checklist', 'misuse', 'recommendation'],
};

export function structureForArticleType(articleType: ArticleType): { sections: readonly string[]; requires_steps: boolean } {
  return { sections: articleStructures[articleType], requires_steps: articleType === 'tutorial' || articleType === 'checklist' };
}
