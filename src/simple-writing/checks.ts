import type { SimpleWritingInput } from './input.js';
import {
  simpleWriterOutputSchema,
  type SimpleWriterOutput,
  type SimpleWritingCheck,
} from './schemas.js';

export interface SimpleWritingChecksResult {
  hard_failures: SimpleWritingCheck[];
  warnings: SimpleWritingCheck[];
}

const safetyPhrases = [
  '我实测', '我测试了', '我最近用了', '我做过', '我的学员', '我的客户', '我的用户', '我赚了', '我靠这个',
  '我们实测', '我们测试了', '保证学会', '保证变现', '一对一辅导', '剩余名额', '马上涨价', '涨价倒计时',
  '退款政策', '365 元', '365元', '499 元', '499元',
] as const;

const hardFormatMarkers: Array<{ code: string; pattern: RegExp; label: string }> = [
  { code: 'local_absolute_path', pattern: /\/(?:Users|home|tmp|private|Volumes|Applications)\//u, label: '本机绝对路径' },
  { code: 'input_hash_exposed', pattern: /input_hash/iu, label: 'input_hash' },
  { code: 'material_field_exposed', pattern: /material_id\s*=/iu, label: 'material_id=' },
  { code: 'source_field_exposed', pattern: /source_id\s*=/iu, label: 'source_id=' },
  { code: 'claim_field_exposed', pattern: /claim_id/iu, label: 'claim_id' },
  { code: 'style_rule_field_exposed', pattern: /style_rule_id/iu, label: 'style_rule_id' },
  { code: 'material_id_exposed', pattern: /mat_[a-f0-9]{12}/u, label: '内部素材 ID' },
];

function check(category: SimpleWritingCheck['category'], code: string, message: string): SimpleWritingCheck {
  return { category, code, message };
}

function normalizedUrl(value: string): string | null {
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

function urlsIn(markdown: string): string[] {
  return (markdown.match(/https?:\/\/[^\s<>"'\])】》」]+/giu) ?? [])
    .map((value) => value.replace(/[.,;:!?，。；：！？]+$/u, ''));
}

function chineseCharacters(value: string): number {
  return value.match(/[\p{Script=Han}]/gu)?.length ?? 0;
}

export function runSimpleWritingChecks(
  rawOutput: unknown,
  input: SimpleWritingInput,
): SimpleWritingChecksResult {
  const hardFailures: SimpleWritingCheck[] = [];
  const warnings: SimpleWritingCheck[] = [];
  const parsed = simpleWriterOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    hardFailures.push(check('output', 'output_schema_invalid', 'Writer 输出不符合 SimpleWriterOutput。'));
    return { hard_failures: hardFailures, warnings };
  }
  const output: SimpleWriterOutput = parsed.data;

  const inputIds = new Set(input.materials.map(({ material_id }) => material_id));
  for (const sourceId of output.used_source_ids) {
    if (!inputIds.has(sourceId)) {
      hardFailures.push(check('source_integrity', 'unknown_source_id', `Writer 引用了输入中不存在的素材 ID：${sourceId}`));
    }
  }

  const allowedUrls = new Set(input.materials.flatMap(({ canonical_url }) => {
    const normalized = normalizedUrl(canonical_url);
    return normalized === null ? [] : [normalized];
  }));
  for (const url of urlsIn(output.article_markdown)) {
    const normalized = normalizedUrl(url);
    if (normalized === null || !allowedUrls.has(normalized)) {
      hardFailures.push(check('source_integrity', 'unknown_external_url', `正文出现输入素材之外的 URL：${url}`));
    }
  }

  for (const phrase of safetyPhrases) {
    if (output.article_markdown.includes(phrase)) {
      warnings.push(check('basic_safety', 'high_risk_phrase', `请人工核查明显高风险短语：“${phrase}”。`));
    }
  }

  const count = chineseCharacters(output.article_markdown);
  if (count < 1_000) warnings.push(check('basic_format', 'article_short', `正文含 ${count} 个中文字符，少于建议的 1000 个。`));
  if (count > 3_000) warnings.push(check('basic_format', 'article_long', `正文含 ${count} 个中文字符，多于建议的 3000 个。`));
  for (const marker of hardFormatMarkers) {
    if (marker.pattern.test(output.article_markdown)) {
      hardFailures.push(check('basic_format', marker.code, `正文暴露了${marker.label}。`));
    }
  }
  return { hard_failures: hardFailures, warnings };
}
