import os from 'node:os';
import path from 'node:path';
import {
  CodexStructuredOutputError,
  CodexStructuredRunner,
  CodexStructuredRunnerError,
  CodexStructuredTimeoutError,
  type CodexStructuredUsage,
} from '../local-agent/codex-structured-runner.js';
import type { SimpleWritingInput } from './input.js';
import { simpleWriterOutputSchema, type SimpleWriterOutput } from './schemas.js';

export interface SimpleWritingProviderCall {
  output: unknown;
  durationMs: number;
  usage: CodexStructuredUsage | null;
}

export interface SimpleWritingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly runtimeVersion: string | null;
  write(input: SimpleWritingInput): Promise<SimpleWritingProviderCall>;
}

export class SimpleWritingProviderError extends Error {
  constructor(
    readonly code: string,
    readonly safeMessage: string = code,
    readonly durationMs: number = 0,
    readonly usage: CodexStructuredUsage | null = null,
  ) {
    super(safeMessage);
    this.name = 'SimpleWritingProviderError';
  }
}

export const SIMPLE_WRITING_SYSTEM_PROMPT = `你是七天假的公众号写作助手。

根据输入的选题和已保存素材，写一篇只讲一个核心观点的文章，供人工审核。

写作前，先在内部确定一句核心判断。全文只服务这句话，不要输出分析过程。

核心原则：

1. 一篇文章只讲一个观点。
2. 观点解释清楚即可，内容不追求面面俱到。
3. 不主动补齐完整流程、全部步骤、所有例外、适用范围、风险列表和操作手册。
4. 最多使用一个核心例子。一个例子讲明白后，不再补第二个例子。
5. 某一段即使正确，但删掉后不影响核心观点，就不要写。
6. 写作目标不是“还能补什么”，而是“还能删掉什么”。
7. 观点讲清楚后立即结束，不复述全文，不升华，不延伸到更多场景。

内容结构：

1. 开头用一个具体问题、变化或场景进入。
2. 如果选题来自近期材料，可以用一到两段点明具体来源和新增信息。
3. 热点材料只负责引出核心观点，不做完整新闻综述。
4. 中间用一个例子把观点解释清楚。
5. 最后给一个很小的行动，或者直接结束。
6. 最多两个二级标题，也可以完全不用小标题。

内容取舍：

1. 除非模板本身就是文章唯一的核心，否则不要输出完整模板。
2. 除非表格能直接讲清核心观点，否则不要使用表格。
3. 全文最多出现一个列表、表格或代码块。
4. 不要同时提供模板、演示表、验收表和失败处理表。
5. 不要为了显得有用，把文章写成教程大全。
6. 不要为了显得严谨，把文章写成免责声明。
7. 不需要解决这个主题的所有问题，只解决当前核心问题。

表达方式：

1. 像在微信里给一个朋友讲清楚一个发现。
2. 不像新闻稿、行业报告、课程讲义或产品文档。
3. 允许直接、口语化、有判断、有取舍。
4. 可以出现一到两句作者判断，例如：
   - 我的判断是……
   - 我会先看……
   - 我更建议……
5. 不要为了增加个人感虚构“我实测、我的学员、我的客户、我的用户”。
6. 少用“值得关注的是、具备条件、实际实施方法、普通使用者、人工确认边界”等报告式表达。
7. 少用“不是……而是……”“不在于……而在于……”。
8. 不要每一段都同样长、同样完整、同样规整。
9. 不写“本文将”“下面我们完整讲解”“接下来分为几个部分”。

篇幅：

1. 优先写 700—1200 个中文字符。
2. 超过 1400 个中文字符时，主动删除不直接服务核心观点的内容。
3. 不要为了达到长度扩写。
4. 一篇短但有明确观点的文章，优于一篇完整但没有取舍的文章。

真实性：

1. fact_source 只能支持已保存摘录范围内的事实。
2. trend_signal 只能说明出现了讨论或需求信号，不能证明普遍趋势。
3. structure_inspiration 只能参考组织方式，不能作为事实来源，也不能照搬表达。
4. 只有摘要时，用一两句话自然说明证据边界。
5. 不虚构数字、经历、客户、学员、效果和产品权益，不自动写价格。
6. 资料不足时写入 uncertain_points，不自行补齐。
7. 不访问链接，不使用输入之外的外部知识。

标题：

1. 标题只承诺文章真正提供的核心价值。
2. 不要轻易使用“完整、全套、终极、从零到一、五个步骤、七个方法”。
3. 除非正文真的以模板为核心，否则标题不要承诺“完整模板、执行卡、清单大全”。
4. 标题优先表达一个具体矛盾、问题或判断。

输出完整的 SimpleWriterOutput JSON。
不输出分析过程。
不写 X。
不生成图片。
不发布。`;

export interface CodexCliSimpleWritingProviderOptions {
  binPath?: string;
  model: string;
  env?: NodeJS.ProcessEnv;
  tempRoot?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

function mapProviderError(error: unknown): never {
  if (error instanceof CodexStructuredTimeoutError) throw new SimpleWritingProviderError('codex_timeout');
  if (error instanceof CodexStructuredRunnerError) throw new SimpleWritingProviderError(error.code);
  throw error;
}

export class CodexCliSimpleWritingProvider implements SimpleWritingProvider {
  readonly providerName = 'codex_cli';
  readonly modelName: string;
  readonly runtimeVersion: string;

  private constructor(private readonly runner: CodexStructuredRunner) {
    this.modelName = runner.modelName;
    this.runtimeVersion = runner.runtimeVersion;
  }

  static async create(options: CodexCliSimpleWritingProviderOptions): Promise<CodexCliSimpleWritingProvider> {
    try {
      return new CodexCliSimpleWritingProvider(await CodexStructuredRunner.create({
        ...(options.binPath === undefined ? {} : { binPath: options.binPath }),
        model: options.model,
        env: options.env ?? process.env,
        tempRoot: options.tempRoot ?? path.join(
          os.homedir(),
          'Library',
          'Application Support',
          'AiAutoContent',
          'tmp',
          'simple-writing-provider',
        ),
        timeoutMs: options.timeoutMs ?? 5 * 60_000,
        ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
      }));
    } catch (error) {
      return mapProviderError(error);
    }
  }

  async write(input: SimpleWritingInput): Promise<SimpleWritingProviderCall> {
    try {
      return await this.runner.run({
        label: 'simple-writing',
        input: {
          writing_date: input.writing_date,
          topic: input.topic,
          materials: input.materials,
        },
        systemInstructions: SIMPLE_WRITING_SYSTEM_PROMPT,
        outputSchema: simpleWriterOutputSchema,
      });
    } catch (error) {
      if (error instanceof CodexStructuredOutputError) {
        const safeMessage = error.safeDiagnostic === null
          ? 'codex_output_invalid'
          : `codex_output_invalid: ${error.safeDiagnostic}`.slice(0, 500);
        throw new SimpleWritingProviderError(
          'codex_output_invalid',
          safeMessage,
          error.durationMs,
          error.usage,
        );
      }
      return mapProviderError(error);
    }
  }
}

export function simpleWritingProviderSettingsFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  defaultModel = 'gpt-5.6-sol',
): { binPath?: string; model: string } {
  const configuredBin = env.SIMPLE_WRITING_CODEX_BIN ?? env.WRITING_CODEX_BIN;
  return {
    ...(configuredBin === undefined ? {} : { binPath: configuredBin }),
    model: env.SIMPLE_WRITING_CODEX_MODEL ?? env.WRITING_CODEX_MODEL ?? defaultModel,
  };
}

const fixtureArticle = `很多人第一次用 AI 做事，最容易卡在同一个地方：回答看起来很完整，真正动手时却不知道从哪里开始，也不知道做到什么程度才算结束。

如果只继续追问“还有什么建议”，答案通常会越来越长，任务却没有更接近完成。一个更实用的做法，是先把任务压缩成三个可以检查的部分：输入是什么、按什么顺序执行、最后看哪几个结果。

先选一个足够小的真实任务。它可以是整理一段会议记录、写一份内容提纲，或者把一天收集到的资料归类。不要一上来就设计整套自动化系统。你现在只需要拿到一个今天能够完成、明天还能重复的最小结果。

第一步，写清固定输入。比如原始材料放在哪里、目标读者是谁、输出要解决什么问题，以及哪些内容不能被补造。输入越具体，后面的返工越少。这里不需要专业模板，一张简单清单就够了。

第二步，按实际顺序写出动作。先读材料，再筛选信息，然后生成草稿，最后人工检查。每一步只保留一个明确动作。如果某一步同时出现收集、判断、改写和发布，就继续拆开，直到任何人都能看懂下一步要做什么。

第三步，为结果写三个验收点。第一个验收输入是否真的被使用；第二个验收输出是否解决了原来的任务；第三个验收是否存在需要人工确认的事实、表达或风险。验收点要能回答“通过还是不通过”，不能只写“效果不错”。

现在把这张任务卡交给 AI，让它严格按输入和步骤完成一次。完成后不要立刻追求更漂亮的文字，先逐项检查。缺少输入就补输入，步骤顺序不对就改步骤，验收标准无法判断就重写标准。

如果结果失败，也不要马上换模型或追加一大段提示词。先判断失败发生在哪一层：材料不够、动作不清楚，还是验收点太模糊。只修正对应的一层，再由人决定是否需要重新执行。这样更容易找到真正的问题。

这套方法的边界也很明确。它不能保证每次输出都正确，也不能替代事实核查。涉及账号权限、付费、对外发送或正式发布时，仍然要保留人工确认。AI 可以把草稿做出来，最终责任不能交给自动流程。

你今天可以直接试一次：挑一个最近重复过两次的任务，写下固定输入、执行顺序和三个验收点。完成后把结果保存下来。下一次遇到同类任务时，先复用这张卡，再根据真实失败修改它。

真正稳定的方法，通常不是一次写出完美提示词，而是把真实任务变成能够执行、能够验收、也能够继续修正的小流程。先完成一个最小结果，再决定是否值得扩大。`;

export function buildFixtureSimpleWriterOutput(input: SimpleWritingInput): SimpleWriterOutput {
  const first = input.materials[0];
  if (first === undefined) throw new SimpleWritingProviderError('fixture_source_missing');
  return simpleWriterOutputSchema.parse({
    primary_title: '别再只问 AI 要建议：把任务改成可验收流程',
    alternative_titles: [
      'AI 总给一堆建议？先写清这三个验收点',
      '从一次性回答到可复用流程，只需要一张任务卡',
    ],
    abstract: '用固定输入、执行顺序和验收点，把一个模糊的 AI 任务整理为能人工检查、下次复用的最小流程。',
    article_markdown: fixtureArticle,
    used_source_ids: [first.material_id],
    uncertain_points: [],
    human_review_notes: ['这是合成 Fixture 草稿，只用于离线验证工程链路。'],
  });
}

export class FixtureSimpleWritingProvider implements SimpleWritingProvider {
  readonly providerName = 'fixture';
  readonly modelName = 'offline-fixture';
  readonly runtimeVersion = 'fixture-v1';

  constructor(
    private readonly outputOverride?: unknown,
    private readonly failureCode?: string,
  ) {}

  async write(input: SimpleWritingInput): Promise<SimpleWritingProviderCall> {
    if (this.failureCode !== undefined) throw new SimpleWritingProviderError(this.failureCode);
    return {
      output: this.outputOverride ?? buildFixtureSimpleWriterOutput(input),
      durationMs: 1,
      usage: null,
    };
  }
}
