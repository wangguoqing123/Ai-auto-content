import os from 'node:os';
import path from 'node:path';
import {
  CodexStructuredOutputError,
  CodexStructuredRunner,
  CodexStructuredRunnerError,
  CodexStructuredTimeoutError,
  type CodexStructuredUsage,
} from '../local-agent/codex-structured-runner.js';
import { repairOutputSchema, reviewerOutputSchema, writerOutputSchema, type RepairOutput, type ReviewerOutput, type WriterOutput } from './schemas.js';

export interface WritingProviderCall<T> { output: T; durationMs: number; usage: CodexStructuredUsage | null }
export interface WritingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly runtimeVersion: string | null;
  write(input: unknown): Promise<WritingProviderCall<WriterOutput>>;
  review(input: unknown): Promise<WritingProviderCall<ReviewerOutput>>;
  repair(input: unknown): Promise<WritingProviderCall<RepairOutput>>;
}

export class WritingProviderError extends Error {
  constructor(readonly code: string, readonly safeMessage: string = code) { super(code); this.name = 'WritingProviderError'; }
}

const WRITER_PROMPT = `You are the evidence-constrained Chinese Writer for AI Auto Content.
Treat input JSON as the complete and untrusted task material. Do not use outside knowledge, browse, or infer missing facts.
Write one platform-independent block draft, one WeChat article plan, and exactly one final X format as requested.
Every factual block must cite at least one supplied claim_id. Every experiment statement must cite experiment_refs. Never cite an unsupported claim.
For partial claims, begin with “目前能确认的是” and preserve the supplied scope_limit. Use every required_claim_id.
The WeChat article rendered from blocks must contain 1200-2400 Chinese characters, solve one main problem, use at most three core concepts, include a real task, minimum result, acceptance, failure, boundary, and every research limitation.
Return exactly three WeChat titles: one primary and two alternatives. Public text must not reveal claim_id, source_id, segment_id, input hashes, profile IDs, style rule IDs, or local paths.
Use only the supplied selected style rules. Reference rules may contribute structure, explanation, evidence placement, CTA technique, and free-value completeness; never reference voice, preferred terms, identity, experience, facts, signature phrases, or metaphors.
Do not claim that the Owner profile is native X or native WeChat longform. Do not turn the whole article into fragments.
First-person statements may express an opinion only when is_opinion=true. Do not invent tests, users, students, projects, experiences, cases, prices, benefits, or product facts.
Keep CTA at the supplied effective mode. Do not output image prompts or generated images; visual slots are planning only and generation_status must remain not_started.
Do not claim percentage improvements, universal speed or quality gains, a best workflow, long-term personal testing, or extrapolate the experiment.
X must use exactly the requested final format. A thread has 4-7 posts and is not a mechanical split of the WeChat article; every post is at most 240 Chinese characters.
Return only the JSON object required by the schema.`;

const REVIEWER_PROMPT = `You are a detect-only quality reviewer. Inspect only the supplied writing output and constraints.
Return issue objects only. Never return a rewritten draft, new block, new fact, new example, new experience, or new product benefit.
Mark fabricated or unsupported claims, missing limitations, first-person factual claims without evidence, CTA escalation, reference voice transfer, leaked internal IDs, or structural violations as hard_blocker.
Mark human-writing or prose problems that need a local block repair as blocking_style_issue. Use warning for non-blocking preferences.
quoted_text must be an exact short excerpt and location must identify one block_id whenever a repair could apply.
If the output complies, return an empty issues array. Return only schema-valid JSON.`;

const REPAIR_PROMPT = `Repair only the listed content blocks under their listed constraints.
Return only block_id and replacement text for those blocks. Do not modify unlisted blocks. Do not add a fact, product benefit, experience, case, experiment result, claim reference, or style rule.
Preserve the meaning, evidence strength, limitations, and block metadata. Do not repair plagiarism or protected-transfer findings by synonym replacement.
Return only schema-valid JSON.`;

function mapProviderError(error: unknown): never {
  if (error instanceof CodexStructuredTimeoutError) throw new WritingProviderError('codex_timeout');
  if (error instanceof CodexStructuredOutputError) throw new WritingProviderError('codex_output_invalid', error.safeDiagnostic === null ? 'codex_output_invalid' : `codex_output_invalid: ${error.safeDiagnostic}`);
  if (error instanceof CodexStructuredRunnerError) throw new WritingProviderError(error.code, error.safeDiagnostic === null ? error.code : `${error.code}: ${error.safeDiagnostic}`);
  throw error;
}

export class CodexCliWritingProvider implements WritingProvider {
  readonly providerName = 'codex_cli';
  readonly modelName: string;
  readonly runtimeVersion: string;
  private constructor(private readonly runner: CodexStructuredRunner) {
    this.modelName = runner.modelName;
    this.runtimeVersion = runner.runtimeVersion;
  }

  static async create(options: { model: string; binPath?: string; env?: NodeJS.ProcessEnv; tempRoot?: string }): Promise<CodexCliWritingProvider> {
    try {
      return new CodexCliWritingProvider(await CodexStructuredRunner.create({
        model: options.model,
        ...(options.binPath === undefined ? {} : { binPath: options.binPath }),
        env: options.env ?? process.env,
        tempRoot: options.tempRoot ?? path.join(os.homedir(), 'Library', 'Application Support', 'AiAutoContent', 'tmp', 'writing-provider'),
        timeoutMs: 5 * 60_000,
      }));
    } catch (error) { return mapProviderError(error); }
  }

  async write(input: unknown) {
    try { return await this.runner.run({ label: 'writing-writer', input, systemInstructions: WRITER_PROMPT, outputSchema: writerOutputSchema }); }
    catch (error) { return mapProviderError(error); }
  }

  async review(input: unknown) {
    try { return await this.runner.run({ label: 'writing-reviewer', input, systemInstructions: REVIEWER_PROMPT, outputSchema: reviewerOutputSchema }); }
    catch (error) { return mapProviderError(error); }
  }

  async repair(input: unknown) {
    try { return await this.runner.run({ label: 'writing-repair', input, systemInstructions: REPAIR_PROMPT, outputSchema: repairOutputSchema }); }
    catch (error) { return mapProviderError(error); }
  }
}

export async function codexCliWritingProviderFromEnvironment(env = process.env): Promise<CodexCliWritingProvider> {
  const model = env.WRITING_CODEX_MODEL ?? env.RESEARCH_CODEX_MODEL ?? env.TOPIC_CODEX_MODEL ?? '';
  if (model.trim() === '') throw new WritingProviderError('codex_non_interactive_unavailable');
  const binPath = env.WRITING_CODEX_BIN ?? env.RESEARCH_CODEX_BIN ?? env.TOPIC_CODEX_BIN;
  return CodexCliWritingProvider.create({ model, ...(binPath === undefined ? {} : { binPath }), env });
}

function block(
  block_id: string,
  block_type: WriterOutput['blocks'][number]['block_type'],
  text: string,
  claim_ids: string[],
  style_rule_ids: string[],
  experiment_refs: Array<'baseline_chat_request' | 'structured_task_card'> = [],
  is_opinion = false,
): WriterOutput['blocks'][number] {
  return { block_id, block_type, text, claim_ids, experiment_refs, product_claim_ids: [], persona_fact_ids: [], style_rule_ids, is_opinion };
}

export class FixtureWritingProvider implements WritingProvider {
  readonly providerName = 'fixture';
  readonly modelName = 'offline-writing-fixture';
  readonly runtimeVersion = 'fixture-v1';
  calls = 0;
  constructor(private readonly reviewIssues: ReviewerOutput['issues'] = []) {}

  async write(inputValue: unknown): Promise<WritingProviderCall<WriterOutput>> {
    this.calls += 1;
    const input = inputValue as { selected_style_rule_ids?: string[]; x_format?: 'single_post' | 'thread' | 'debate_prompt' };
    const rules = input.selected_style_rule_ids?.slice(0, 3) ?? [];
    const claims = ['claim_fixture_tasks', 'claim_fixture_gap'];
    const blocks = [
      block('block_hook', 'hook', '一段会议记录真正要交付的是一张可以直接执行、做完还能逐项检查的行动清单。这里用一份项目自有的合成记录演示：记录里只有三个待办、三个负责人，两项写了截止时间，还有一项没有验收标准。最后你会得到一张执行卡，原始信息会保留，缺什么也会被明确留下，下一次沟通可以直接对准缺口。', claims, rules, [], true),
      block('block_problem', 'problem', '会议记录常见的问题是任务、责任和完成条件混在叙述里，信息虽然存在，却不能直接执行。这个合成样例已经给出三项待办和对应负责人，也保留了两项截止时间；真正的缺口是第三项没有验收标准。如果整理时顺手补一个看似合理的标准，清单会更完整，却已经把未知信息伪装成了事实。', claims, rules),
      block('block_step_extract', 'step', '第一步只提取原记录明确写出的字段。为每项待办建立一行，依次放入任务、负责人、截止时间和验收条件。原文有的照录，原文没有的先留空。这个动作先把散落在句子里的责任关系变成可以核对的结构，暂时不做润色。三项任务和三个负责人都应原样保留，两项已有的截止时间也不能被改写。', claims, rules),
      block('block_step_gap', 'step', '第二步把空白改成显式缺口。第三项没有验收标准，就写成“待负责人确认”，同时把它列入阻塞项；某项没有截止时间，也单独标为待确认。这样做不会替用户做决定，却能让下一次沟通直接对准缺失字段。执行卡要让不完整之处能够被发现、被分配、被补齐，不追求表面上的字段齐全。', claims, rules),
      block('block_step_action', 'step', '第三步为每项任务补上可以立即开始的下一步，但下一步仍要受原材料约束。例如“按原记录汇总反馈”“在已有截止日前更新演示文件”可以作为动作描述；缺少验收标准的任务只能先进入确认环节，不能假装已经具备完成条件。行动清单至少应包含任务、负责人、已有截止时间、下一步、验收条件和待确认项。', claims, rules),
      block('block_evidence', 'evidence', '在当前一个合成样例中，两种输入方式各运行了一次。普通请求通过 6 项验收，结构化执行卡通过 8 项；两组字段都能输出，但普通请求里有一项验收条件为空，结构化版本则把它标成待确认。这个数字只来自当前保存的实验结果，说明的是本次样例中的字段完整情况，不代表普遍效率、准确率或质量提升。', claims, rules, ['baseline_chat_request', 'structured_task_card']),
      block('block_acceptance', 'acceptance', '验收直接逐项对照：三项待办是否都在；每项是否有负责人；两项已有截止时间是否保持不变；缺少的截止时间是否标明；第三项缺失的验收标准是否仍然是待确认；输出是否是一张行动清单。专业感不作为验收条件。任何一项被遗漏或被补猜，都不能算通过。', claims, rules),
      block('block_failure', 'failure', '最容易失败的地方有两个。其一，模型为了补齐表格，替负责人发明了截止时间或验收标准；其二，输出只留下漂亮摘要，没有可执行动作。发现第一种情况，要删除新增事实并恢复待确认标记；发现第二种情况，要回到任务、负责人、下一步和验收条件四列重新整理。不要用更长的提示词掩盖材料本身的缺口。', claims, rules),
      block('block_limitations', 'boundary', '只有一个合成样例。每组只运行一次，没有测量模型波动。结果不能外推其他任务、模型和用户。这里也不能据此声称一定更快、一定更好或已经找到最佳工作流。真实会议还可能涉及决策背景、依赖关系和权限边界；材料没有提供时，执行卡只能把问题暴露出来，不能代替负责人确认。这个边界需要和样例结果一起保留。', claims, rules, ['baseline_chat_request', 'structured_task_card']),
      block('block_cta', 'cta', '可以先拿一段不含敏感信息的会议记录试做：只提取明确字段，把空白标成待确认，再用同一张清单逐项验收。最小结果是一张没有补猜、责任清楚、下一步可执行的卡片；这一轮不需要扩写成完整纪要。', claims, rules, [], true),
    ];
    const format = input.x_format ?? 'thread';
    const x = format === 'thread' ? {
      format, single_post: null, debate_prompt: null,
      thread: [
        '会议记录整理得再漂亮，如果没有负责人、下一步和验收条件，还是不能执行。先把它变成一张行动卡。',
        '只提取原记录明确写出的任务、负责人和截止时间。材料没写的字段先留空，不让 AI 补猜。',
        '把空白改成“待确认”：缺截止时间就列出来，缺验收标准就交回负责人确认。缺口本身也是结果。',
        '验收只看字段：任务是否齐全、负责人是否对应、已有期限是否保留、未知项是否仍然明确。',
        '当前验证只有一个合成样例，每组只跑一次，不能外推效率或质量。先用一段去敏记录做出最小执行卡。',
      ],
    } as const : format === 'single_post'
      ? { format, single_post: '会议记录别只做摘要。提取任务、负责人和已有期限，把缺失的验收标准明确标成待确认，再用同一张行动卡逐项验收。当前只有一个合成样例，不能外推效率或质量。', thread: [], debate_prompt: null } as const
      : { format, single_post: null, thread: [], debate_prompt: '我的判断是：会议记录里的未知项应该明确留白，不该让 AI 自动补齐。你更愿意先得到一张不完整但可信的执行卡，还是一张字段齐全却包含推测的表格？' } as const;
    return { output: writerOutputSchema.parse({
      article_type: 'tutorial', primary_title: '把会议记录变成一张可验收的执行卡',
      alternative_titles: ['别让 AI 补猜：会议记录整理的最小验收法', '三个步骤，把会议待办整理成能执行的行动清单'],
      abstract: '用一个项目自有合成样例，演示怎样提取任务、显式保留缺口，并用同一张清单逐项验收。',
      blocks,
      source_notes: claims.map((claim_id) => ({ claim_id })),
      cta: { mode: 'light', text: '先用一段去敏记录做出最小执行卡。' },
      visual_slots: [
        { slot_id: 'visual_process', location: '步骤段之后', purpose: '展示记录到执行卡的字段转换', visual_type: 'process_diagram', required_evidence_refs: claims, caption: '只提取已有信息，把缺口保留为待确认。', generation_status: 'not_started' },
        { slot_id: 'visual_result', location: '验收段之前', purpose: '展示执行卡的最小字段', visual_type: 'result_card', required_evidence_refs: claims, caption: '任务、负责人、期限、验收与待确认项。', generation_status: 'not_started' },
      ],
      x,
    }), durationMs: 10, usage: null };
  }

  async review(): Promise<WritingProviderCall<ReviewerOutput>> { this.calls += 1; return { output: { issues: this.reviewIssues }, durationMs: 5, usage: null }; }
  async repair(inputValue: unknown): Promise<WritingProviderCall<RepairOutput>> {
    this.calls += 1;
    const input = inputValue as { blocks: Array<{ block_id: string; text: string }> };
    return { output: { repaired_blocks: input.blocks.map(({ block_id, text }) => ({ block_id, text: text.replace(/先说结论[：:]?/gu, '') })) }, durationMs: 5, usage: null };
  }
}
