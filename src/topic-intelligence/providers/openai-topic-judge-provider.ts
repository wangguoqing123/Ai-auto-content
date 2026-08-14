import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { buildTopicJudgeData, TOPIC_JUDGE_SYSTEM_PROMPT } from '../prompt.js';
import { topicJudgeProviderResultSchema } from '../schemas.js';
import type { TopicJudgeInput, TopicJudgeProvider, TopicJudgeProviderCall } from './topic-judge-provider.js';
import { TopicJudgeUnavailableError } from './topic-judge-provider.js';

export interface OpenAITopicJudgeProviderOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
}

export class OpenAITopicJudgeProvider implements TopicJudgeProvider {
  readonly providerName = 'openai';
  readonly modelName: string;
  private readonly client: OpenAI;

  constructor(options: OpenAITopicJudgeProviderOptions) {
    if (options.apiKey.trim() === '') throw new TopicJudgeUnavailableError('OPENAI_API_KEY is required');
    if (options.model.trim() === '') throw new TopicJudgeUnavailableError('TOPIC_LLM_MODEL is required');
    this.modelName = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      ...(options.baseURL === undefined || options.baseURL.trim() === '' ? {} : { baseURL: options.baseURL }),
      timeout: 60_000,
      maxRetries: 0,
    });
  }

  private async call(input: TopicJudgeInput, validationErrors: string[]): Promise<TopicJudgeProviderCall> {
    const startedAt = Date.now();
    try {
      const response = await this.client.responses.parse({
        model: this.modelName,
        input: [
          { role: 'system', content: TOPIC_JUDGE_SYSTEM_PROMPT },
          { role: 'user', content: buildTopicJudgeData(input, validationErrors) },
        ],
        text: { format: zodTextFormat(topicJudgeProviderResultSchema, 'daily_topic_judge') },
      });
      return {
        output: response.output_parsed,
        durationMs: Date.now() - startedAt,
        usage: response.usage === undefined ? null : {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
        },
      };
    } catch (error) {
      const safeMessage = error instanceof OpenAI.APIError
        ? `OpenAI request failed (${error.status ?? 'network'})`
        : 'OpenAI request failed';
      throw new TopicJudgeUnavailableError(safeMessage);
    }
  }

  judge(input: TopicJudgeInput): Promise<TopicJudgeProviderCall> {
    return this.call(input, []);
  }

  repair(input: TopicJudgeInput, validationErrors: string[]): Promise<TopicJudgeProviderCall> {
    return this.call(input, validationErrors.slice(0, 20));
  }
}
