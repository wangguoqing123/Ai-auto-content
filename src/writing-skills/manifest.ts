export const writingSkillManifest = {
  humanWriting: {
    id: 'human-writing',
    commit: '4fda173f3fef7fb808f3eba991eeb2528ea4b189',
    version: '1.1.0',
    role: 'positive_chinese_writing_and_post_draft_revision',
    forbids: ['author_profile_creation', 'serial_full_text_rewrite'],
  },
  noAiSlop: {
    id: 'no-ai-slop',
    commit: 'd30eddb9e04562234f2070b5ee63ca4649d9a05e',
    role: 'post_draft_detect_only_review',
    forbids: ['first_draft_generation', 'new_facts_examples_or_opinions', 'full_text_rewrite'],
  },
} as const;
