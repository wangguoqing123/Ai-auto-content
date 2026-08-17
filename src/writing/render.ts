import type { ResearchPack } from '../research/schemas.js';
import { masterDraftSchema, wechatDraftSchema, xDraftSchema, type ContentBlock, type WriterOutput } from './schemas.js';

const headings: Record<ContentBlock['block_type'], string> = {
  hook: '', problem: '先看清真正的卡点', analysis: '判断与分析', step: '执行步骤', example: '例子', evidence: '这次样例看到了什么',
  acceptance: '怎样验收', failure: '失败时怎样处理', boundary: '适用边界', cta: '现在可以怎么做',
};

function renderBlocks(blocks: readonly ContentBlock[]): string {
  let previousHeading = '';
  const sections: string[] = [];
  for (const block of blocks) {
    const heading = headings[block.block_type];
    if (heading !== '' && heading !== previousHeading) sections.push(`## ${heading}`);
    sections.push(block.text.trim());
    previousHeading = heading;
  }
  return sections.join('\n\n');
}

export function chineseCharacterCount(value: string): number { return value.match(/\p{Script=Han}/gu)?.length ?? 0; }

export function renderWriterOutput(output: WriterOutput, research: ResearchPack) {
  const rendered = renderBlocks(output.blocks);
  const claims = new Map(research.verified_claims.map((claim) => [claim.claim_id, claim]));
  const sources = new Map(research.sources.map((source) => [source.source_id, source]));
  const seen = new Set<string>();
  const sourceNotes = output.source_notes.flatMap(({ claim_id }) => {
    const claim = claims.get(claim_id);
    if (claim === undefined || claim.support_status === 'unsupported' || claim.source_id === null || seen.has(claim_id)) return [];
    seen.add(claim_id);
    const source = sources.get(claim.source_id);
    return [{ title: source?.title ?? '公开来源', url: source?.canonical_url ?? null, support_status: claim.support_status, scope_limit: claim.scope_limit }];
  });
  return {
    master: masterDraftSchema.parse({ article_type: output.article_type, blocks: output.blocks, rendered_markdown: rendered }),
    wechat: wechatDraftSchema.parse({
      primary_title: output.primary_title, alternative_titles: output.alternative_titles, abstract: output.abstract,
      article_type: output.article_type, blocks: output.blocks, article_markdown: `# ${output.primary_title}\n\n${rendered}`,
      chinese_character_count: chineseCharacterCount(rendered), source_notes: sourceNotes, cta: output.cta, visual_slots: output.visual_slots,
    }),
    x: xDraftSchema.parse(output.x),
  };
}
