import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Material, RunLog } from '../types.js';

const REJECTION_LABELS: Record<string, string> = {
  low_relevance: '与 AI 小白无关或相关度不足',
  below_overall_threshold: '综合分未达到阈值',
  stale_or_unknown_publish_date: '时间过旧或发布时间缺失',
  unverified_source: '可信度不足',
  low_level_only: '只有底层参数或研究细节',
  invalid_feed_item: '缺少标题或链接',
  duplicate_content: '重复内容',
};

const TAG_EXPLANATIONS: Record<string, string> = {
  beginner: '包含入门、教程或上手信号',
  work_task: '对应文档、会议、表格或其他真实工作任务',
  ai_basics: '涉及普通用户常用的 AI 基础能力',
  content_and_video: '涉及内容、图片、音频或视频工作流',
  automation: '涉及可复用的自动化工作流',
  ai_coding: '涉及 AI 编程、应用或网站开发',
  actionable_update: '包含明确的发布、更新或可用功能',
  application_case: '包含案例、示例或分步操作',
  official_update: '来自官方产品更新来源',
  developer_tool: '涉及 AI 开发工具',
  ai_video: '涉及 AI 视频工具',
  tutorial: '属于教程类来源',
};

function markdownText(value: string): string {
  return value.replace(/([\\`*_{}\[\]<>])/g, '\\$1');
}

export function explainMaterial(material: Material): string {
  const explanations = material.tags
    .map((tag) => TAG_EXPLANATIONS[tag])
    .filter((value): value is string => Boolean(value));
  if (material.target_users.includes('ai_beginner')) explanations.unshift('来源明确面向 AI 小白');
  const unique = [...new Set(explanations)].slice(0, 3);
  return `规则依据：${unique.length > 0 ? unique.join('；') : '通过了可配置的相关度和综合分阈值'}`;
}

export interface DailyReportInput {
  date: string;
  run: RunLog;
  dailyMaterials: Material[];
  extraRejections?: Record<string, number>;
}

export function generateDailyReport(input: DailyReportInput): string {
  const { date, run, dailyMaterials } = input;
  const accepted = dailyMaterials
    .filter((material) => material.status === 'accepted')
    .sort((left, right) => right.overall_score - left.overall_score
      || right.freshness_score - left.freshness_score
      || left.canonical_url.localeCompare(right.canonical_url));
  const rejectionCounts = new Map<string, number>();

  for (const material of dailyMaterials.filter((item) => item.status === 'rejected')) {
    for (const reason of material.rejection_reasons) {
      rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
    }
  }
  for (const [reason, count] of Object.entries(input.extraRejections ?? {})) {
    rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + count);
  }
  if (run.items_duplicate > 0) rejectionCounts.set('duplicate_content', run.items_duplicate);

  const lines = [
    `# ${date} AI 素材日报`,
    '',
    '## 本次运行概况',
    '',
    `- 信源数量：${run.sources_total}`,
    `- 成功信源：${run.sources_succeeded}`,
    `- 失败信源：${run.sources_failed}`,
    `- 原始条目：${run.items_fetched}`,
    `- 新增有效素材：${run.items_new}`,
    `- 重复素材：${run.items_duplicate}`,
    `- 低相关或未达标素材：${run.items_rejected}`,
    `- 运行耗时：${run.duration_ms} ms`,
    '',
    '## 今日值得关注',
    '',
  ];

  if (accepted.length === 0) {
    lines.push('今日没有足够高质量的新素材。', '');
  } else {
    for (const [index, material] of accepted.slice(0, 10).entries()) {
      lines.push(
        `### ${index + 1}. ${markdownText(material.title)}`,
        '',
        `- 来源：${markdownText(material.source_name)}`,
        `- 原始发布时间：${material.published_at ?? '未知'}`,
        `- 原始链接：<${material.source_url}>`,
        `- 相关度分数：${material.relevance_score}`,
        `- 新鲜度分数：${material.freshness_score}`,
        `- 可信度分数：${material.evidence_score}`,
        `- 综合分：${material.overall_score}`,
        `- 为什么可能适合 AI 小白：${explainMaterial(material)}`,
        '',
      );
    }
  }

  lines.push('## 暂不建议进入选题池', '');
  if (rejectionCounts.size === 0) lines.push('- 无', '');
  else {
    for (const [reason, count] of [...rejectionCounts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`- ${REJECTION_LABELS[reason] ?? markdownText(reason)}：${count}`);
    }
    lines.push('');
  }

  lines.push('## 抓取失败来源', '');
  if (run.failures.length === 0) lines.push('- 无', '');
  else {
    for (const failure of run.failures) {
      lines.push(`- ${markdownText(failure.source_name)}（${failure.source_id}）：${markdownText(failure.error)}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export async function saveDailyReport(rootDir: string, date: string, report: string): Promise<string> {
  const filePath = path.join(rootDir, 'reports', 'materials', `${date}.md`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, report, 'utf8');
  return filePath;
}
