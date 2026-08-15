import { structureForArticleType } from '../style-intelligence/dynamic-structure.js';
import type { WritingContext } from './types.js';

const sharedPositiveRules = [
  'Check that nonfiction material is sufficient before drafting.',
  'Fix the speaking position: what the writer knows, infers, and cannot claim.',
  'Advance with facts, actions, distinctions, consequences, or verified examples.',
  'Keep factual evidence close to the judgment it supports.',
  'Use varied Chinese sentence and paragraph rhythm when it serves the material.',
] as const;

const revisionRules = [
  'Remove unsupported facts, experiences, quotations, examples, and opinions.',
  'Replace reversal rhetoric and fake insight markers with the supported point.',
  'Break mechanical parallelism and overly uniform sentence rhythm.',
  'Remove business jargon, model signposts, nominalization, and fake-profound endings.',
  'Preserve normal tutorial lists, code, URLs, metadata, source fields, and direct quotations.',
] as const;

export type HumanWritingPhase = 'pre_draft' | 'post_draft';

export function adaptHumanWriting(context: WritingContext, phase: HumanWritingPhase) {
  const materialGate = context.factual_mode === 'nonfiction' && context.material_count < 5
    ? { status: 'insufficient_material' as const, maximum_delivery: 'short_bounded_answer' as const }
    : { status: 'ready' as const, maximum_delivery: 'requested_format' as const };
  const structure = structureForArticleType(context.article_type);
  return {
    skill_id: 'human-writing',
    phase,
    material_gate: materialGate,
    positive_rules: phase === 'pre_draft' ? [...sharedPositiveRules] : [],
    article_structure: phase === 'pre_draft' ? structure : null,
    revision_rules: phase === 'post_draft' ? [...revisionRules] : [],
    creates_author_profile: false,
    permits_full_text_serial_rewrite: false,
  };
}
