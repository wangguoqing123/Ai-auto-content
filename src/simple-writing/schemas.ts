import { z } from 'zod';

const title = z.string().trim().min(1).max(60);

export const simpleWriterOutputSchema = z.strictObject({
  primary_title: title,
  alternative_titles: z.array(title).min(2).max(2),
  abstract: z.string().trim().min(1).max(300),
  article_markdown: z.string().trim().min(1).max(30_000),
  used_source_ids: z.array(z.string().trim().min(1)).min(1).max(20),
  uncertain_points: z.array(z.string().trim().min(1).max(500)).max(10),
  human_review_notes: z.array(z.string().trim().min(1).max(500)).max(10),
});

export const simpleWritingCheckSchema = z.strictObject({
  category: z.enum(['output', 'source_integrity', 'basic_safety', 'basic_format']),
  code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(500),
});

const usageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
  total_tokens: z.number().int().nonnegative().nullable(),
});

export const simpleWritingPackSchema = z.strictObject({
  version: z.literal(1),
  writing_date: z.iso.date(),
  run_id: z.string().trim().min(1).max(100),
  status: z.enum(['success', 'failed']),
  decision: z.enum([
    'READY_FOR_HUMAN_REVIEW',
    'NO_CONTENT',
    'WAITING_FOR_TOPIC',
    'BLOCKED_NO_SOURCES',
  ]).nullable(),
  topic: z.strictObject({
    working_title: z.string().trim().min(1).max(200),
    topic_signature: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  }).nullable(),
  input_summary: z.strictObject({
    source_count: z.number().int().nonnegative(),
    source_ids: z.array(z.string().trim().min(1)).max(20),
  }),
  output: simpleWriterOutputSchema.nullable(),
  checks: z.strictObject({
    hard_failures: z.array(simpleWritingCheckSchema),
    warnings: z.array(simpleWritingCheckSchema),
  }).nullable(),
  model: z.strictObject({
    provider: z.string(),
    model: z.string(),
    runtime_version: z.string().max(200).nullable(),
    calls: z.union([z.literal(0), z.literal(1)]),
    duration_ms: z.number().int().nonnegative(),
    usage: usageSchema.nullable(),
  }),
  human_gate: z.strictObject({
    required: z.literal(true),
    status: z.literal('unreviewed'),
    automated_publish_allowed: z.literal(false),
  }),
  error_code: z.string().max(100).nullable(),
  error_message_safe: z.string().max(500).nullable(),
  created_at: z.iso.datetime(),
});

export const simpleWritingConfigSchema = z.strictObject({
  version: z.literal(1),
  input: z.strictObject({
    maximum_sources: z.number().int().min(1).max(20),
  }),
  model: z.strictObject({
    default_model: z.string().trim().min(1),
    timeout_ms: z.number().int().min(1_000).max(600_000),
  }),
});

export type SimpleWriterOutput = z.infer<typeof simpleWriterOutputSchema>;
export type SimpleWritingCheck = z.infer<typeof simpleWritingCheckSchema>;
export type SimpleWritingPack = z.infer<typeof simpleWritingPackSchema>;
export type SimpleWritingConfig = z.infer<typeof simpleWritingConfigSchema>;
export type SimpleWritingDecision = NonNullable<SimpleWritingPack['decision']>;
