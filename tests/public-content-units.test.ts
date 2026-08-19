import { beforeAll, describe, expect, it } from 'vitest';
import { FixtureWritingProvider } from '../src/writing/provider.js';
import {
  assignStableWriterUnitIds,
  applyPublicContentUnitPatches,
  enumeratePublicContentUnits,
  renderPublicContentUnits,
} from '../src/writing/public-content-units.js';
import {
  publicContentSurfaceSchema,
  writerOutputSchema,
  writerProviderOutputSchema,
  type PublicContentUnit,
  type WriterOutput,
} from '../src/writing/schemas.js';

let output: WriterOutput;
let units: PublicContentUnit[];

beforeAll(async () => {
  output = (await new FixtureWritingProvider().write({ selected_style_rule_ids: ['OCV-01'], x_format: 'thread' })).output;
  units = enumeratePublicContentUnits(output);
});

function changed(unitId: string, text: string): PublicContentUnit {
  const current = units.find(({ unit_id }) => unit_id === unitId)!;
  return { ...current, text };
}

describe('Public Content Unit enumeration and restoration', () => {
  it('1. defines exactly eight public surface types', () => {
    expect(publicContentSurfaceSchema.options).toHaveLength(8);
  });

  it('2. creates the stable primary-title Unit', () => {
    expect(units).toContainEqual(expect.objectContaining({ unit_id: 'wechat.primary_title', surface: 'wechat_primary_title', index: null }));
  });

  it('3. creates two independent alternative-title Units', () => {
    expect(units.filter(({ surface }) => surface === 'wechat_alternative_title').map(({ unit_id, index }) => ({ unit_id, index }))).toEqual([
      { unit_id: 'wechat.alternative_title.0', index: 0 }, { unit_id: 'wechat.alternative_title.1', index: 1 },
    ]);
  });

  it('4. creates one independent abstract Unit', () => {
    expect(units.filter(({ surface }) => surface === 'wechat_abstract')).toEqual([expect.objectContaining({ unit_id: 'wechat.abstract' })]);
  });

  it('5. converts every Content Block to one Unit', () => {
    const blockUnits = units.filter(({ surface }) => surface === 'wechat_block');
    expect(blockUnits).toHaveLength(output.blocks.length);
    expect(blockUnits.map(({ unit_id }) => unit_id)).toEqual(output.blocks.map(({ block_id }) => `wechat.block.${block_id}`));
  });

  it('6. creates one independent CTA Unit', () => {
    expect(units).toContainEqual(expect.objectContaining({ unit_id: 'wechat.cta', surface: 'wechat_cta' }));
  });

  it('7. creates one independent Unit per X thread item', () => {
    const xUnits = units.filter(({ surface }) => surface === 'x_thread_item');
    expect(xUnits).toHaveLength(output.x.thread.items.length);
    expect(xUnits.map(({ unit_id }) => unit_id)).toEqual(output.x.thread.items.map((_unit, index) => `x.thread.${index}`));
  });

  it('8. keeps every unit_id unique and stable across enumeration', () => {
    const first = units.map(({ unit_id }) => unit_id);
    const second = enumeratePublicContentUnits(output).map(({ unit_id }) => unit_id);
    expect(new Set(first).size).toBe(first.length);
    expect(second).toEqual(first);
  });

  it('9. does not model static Markdown headings as public Units', () => {
    expect(units.map(({ text }) => text)).not.toContain('怎样验收');
    expect(units.map(({ text }) => text)).not.toContain('失败时怎样处理');
  });

  it('10. renders public text without exposing internal Unit IDs', () => {
    const rendered = renderPublicContentUnits(units);
    expect(rendered).toContain(output.primary_title.text);
    expect(rendered).not.toMatch(/wechat\.(?:primary_title|block)|x\.thread\./u);
  });

  it('11. restores an abstract patch to the exact Writer Output field', () => {
    const next = applyPublicContentUnitPatches(output, [changed('wechat.abstract', '新的摘要文本。')]);
    expect(next.abstract.text).toBe('新的摘要文本。');
    expect(next.primary_title).toEqual(output.primary_title);
  });

  it('12. restores an X thread patch to the exact item', () => {
    const next = applyPublicContentUnitPatches(output, [changed('x.thread.2', '新的第三条 X 文本。')]);
    expect(next.x.thread.items[2]!.text).toBe('新的第三条 X 文本。');
    expect(next.x.thread.items[1]).toEqual(output.x.thread.items[1]);
  });

  it('13. restores a Content Block patch without changing block identity', () => {
    const id = `wechat.block.${output.blocks[0]!.block_id}`;
    const next = applyPublicContentUnitPatches(output, [changed(id, '新的 Block 文本。')]);
    expect(next.blocks[0]).toMatchObject({ block_id: output.blocks[0]!.block_id, block_type: output.blocks[0]!.block_type, text: '新的 Block 文本。' });
  });

  it('14. rejects an unknown Unit patch', () => {
    expect(() => applyPublicContentUnitPatches(output, [{ ...units[0]!, unit_id: 'wechat.block.block_unknown' }])).toThrow('public_content_unit_patch_unknown');
  });

  it('15. rejects duplicate Unit patches', () => {
    const patch = changed('wechat.abstract', '摘要。');
    expect(() => applyPublicContentUnitPatches(output, [patch, patch])).toThrow('public_content_unit_patch_duplicate');
  });

  it('16. rejects a surface or index identity change', () => {
    expect(() => applyPublicContentUnitPatches(output, [{ ...changed('wechat.abstract', '摘要。'), surface: 'wechat_cta' }])).toThrow('public_content_unit_identity_changed');
  });

  it('17. revalidates the full Writer Output after Unit restoration', () => {
    const next = applyPublicContentUnitPatches(output, [changed('wechat.cta', '新的轻 CTA。')]);
    expect(writerOutputSchema.safeParse(next).success).toBe(true);
    expect(enumeratePublicContentUnits(next)).toHaveLength(units.length);
  });

  it('18. replaces one-based Provider thread IDs with code-owned stable IDs', () => {
    const providerOutput = structuredClone(output);
    providerOutput.x.thread.items.forEach((unit, index) => { unit.unit_id = `x.thread.${index + 1}`; });
    expect(writerProviderOutputSchema.safeParse(providerOutput).success).toBe(true);
    expect(writerOutputSchema.safeParse(providerOutput).success).toBe(false);

    const normalized = assignStableWriterUnitIds(providerOutput);
    expect(normalized.x.thread.items.map(({ unit_id }) => unit_id)).toEqual(
      normalized.x.thread.items.map((_unit, index) => `x.thread.${index}`),
    );
    expect(writerOutputSchema.safeParse(normalized).success).toBe(true);
  });
});
