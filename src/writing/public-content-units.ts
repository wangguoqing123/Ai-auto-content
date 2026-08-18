import { sha256, stableJson } from '../style-intelligence/hash.js';
import {
  publicContentUnitSchema,
  writerOutputSchema,
  type ContentBlock,
  type PublicContentSurface,
  type PublicContentUnit,
  type PublicTextUnit,
  type WriterOutput,
} from './schemas.js';

function withSurface(unit: PublicTextUnit, surface: PublicContentSurface, index: number | null): PublicContentUnit {
  return publicContentUnitSchema.parse({ ...unit, surface, index });
}

function blockUnit(block: ContentBlock, index: number): PublicContentUnit {
  return publicContentUnitSchema.parse({
    unit_id: `wechat.block.${block.block_id}`,
    surface: 'wechat_block',
    index,
    text: block.text,
    claim_ids: block.claim_ids,
    experiment_refs: block.experiment_refs,
    product_claim_ids: block.product_claim_ids,
    persona_fact_ids: block.persona_fact_ids,
    style_rule_ids: block.style_rule_ids,
    is_opinion: block.is_opinion,
  });
}

export function enumeratePublicContentUnits(input: WriterOutput): PublicContentUnit[] {
  const output = writerOutputSchema.parse(input);
  const units: PublicContentUnit[] = [
    withSurface(output.primary_title, 'wechat_primary_title', null),
    ...output.alternative_titles.map((unit, index) => withSurface(unit, 'wechat_alternative_title', index)),
    withSurface(output.abstract, 'wechat_abstract', null),
    ...output.blocks.map(blockUnit),
    withSurface(output.cta.unit, 'wechat_cta', null),
  ];
  if (output.x.format === 'single_post') units.push(withSurface(output.x.single_post!, 'x_single_post', null));
  else if (output.x.format === 'thread') units.push(...output.x.thread.items.map((unit, index) => withSurface(unit, 'x_thread_item', index)));
  else units.push(withSurface(output.x.debate_prompt!, 'x_debate_prompt', null));
  const ids = units.map(({ unit_id }) => unit_id);
  if (new Set(ids).size !== ids.length) throw new Error('public_content_unit_id_duplicate');
  return units;
}

function publicText(unit: PublicContentUnit): PublicTextUnit {
  const { surface: _surface, index: _index, ...value } = unit;
  return value;
}

export function applyPublicContentUnitPatches(input: WriterOutput, patches: readonly PublicContentUnit[]): WriterOutput {
  const output = writerOutputSchema.parse(input);
  const current = enumeratePublicContentUnits(output);
  const known = new Map(current.map((unit) => [unit.unit_id, unit]));
  const patchMap = new Map<string, PublicContentUnit>();
  for (const raw of patches) {
    const patch = publicContentUnitSchema.parse(raw);
    if (patchMap.has(patch.unit_id)) throw new Error('public_content_unit_patch_duplicate');
    const existing = known.get(patch.unit_id);
    if (existing === undefined) throw new Error('public_content_unit_patch_unknown');
    if (patch.surface !== existing.surface || patch.index !== existing.index) throw new Error('public_content_unit_identity_changed');
    patchMap.set(patch.unit_id, patch);
  }
  const value = (id: string): PublicTextUnit => publicText(patchMap.get(id) ?? known.get(id)!);
  const blocks = output.blocks.map((block) => {
    const unit = patchMap.get(`wechat.block.${block.block_id}`);
    if (unit === undefined) return block;
    return {
      ...block,
      text: unit.text,
      claim_ids: unit.claim_ids,
      experiment_refs: unit.experiment_refs,
      product_claim_ids: unit.product_claim_ids,
      persona_fact_ids: unit.persona_fact_ids,
      style_rule_ids: unit.style_rule_ids,
      is_opinion: unit.is_opinion,
    };
  });
  const x = output.x.format === 'single_post'
    ? { ...output.x, single_post: value('x.single_post') }
    : output.x.format === 'thread'
      ? { ...output.x, thread: { items: output.x.thread.items.map((_unit, index) => value(`x.thread.${index}`)) } }
      : { ...output.x, debate_prompt: value('x.debate_prompt') };
  return writerOutputSchema.parse({
    ...output,
    primary_title: value('wechat.primary_title'),
    alternative_titles: [value('wechat.alternative_title.0'), value('wechat.alternative_title.1')],
    abstract: value('wechat.abstract'),
    blocks,
    cta: { ...output.cta, unit: value('wechat.cta') },
    x,
  });
}

export function renderPublicContentUnits(units: readonly PublicContentUnit[]): string {
  return units.map(({ text }) => text).filter((value) => value.trim() !== '').join('\n');
}

export function publicContentUnitSha256(unit: PublicContentUnit): string {
  return sha256(stableJson(unit));
}
