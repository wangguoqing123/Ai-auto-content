import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserPipelineResult } from '../browser-pipeline.js';
import type { UnifiedMaterial } from '../types.js';

export function sanitizeReportValue(value: string): string {
  return value
    .replace(/([?&](?:xsec_token|signature|pass_ticket|exportkey|sessionid|auth_token|ct0)=)[^&\s)]+/gi, '$1[redacted]')
    .replace(/\b(?:Cookie|Authorization):\s*\S+/gi, '[sensitive header redacted]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[redacted]');
}

function metric(value: number | null): string {
  return value === null ? 'null' : String(value);
}

function score(material: UnifiedMaterial): number {
  return material.engagement.views ?? material.engagement.likes ?? material.engagement.reposts ?? -1;
}

export function renderBrowserReport(result: BrowserPipelineResult): string {
  const twitter = result.platforms.find((platform) => platform.platform === 'twitter');
  const weixin = result.platforms.find((platform) => platform.platform === 'weixin');
  const weixinMaterials = weixin?.materials ?? [];
  const downloaded = weixinMaterials.filter((material) => material.content_downloaded).length;
  const unresolved = weixinMaterials.filter((material) => material.source_access_status === 'unresolved' || material.status === 'quarantined').length;
  const duration = Math.max(0, Date.parse(result.finished_at) - Date.parse(result.started_at));
  const lines = [
    `# ${result.collection_date} Browser 素材日报`,
    '',
    '## 运行概况',
    '',
    `- 总体状态：${result.status}`,
    `- X 状态：${twitter?.status ?? 'unavailable'}`,
    `- 公众号状态：${weixin?.status ?? 'unavailable'}`,
    `- 原始材料：${result.raw_materials_count}`,
    `- 唯一材料：${result.materials_count}`,
    `- 重复材料：${result.duplicate_materials_count}`,
    `- 公众号原文解析成功数：${downloaded}`,
    `- 公众号 unresolved / quarantined 数量：${unresolved}`,
    `- 运行耗时：${duration} ms`,
    '',
    '## X 候选',
    '',
  ];
  const xCandidates = [...(twitter?.materials ?? [])].sort((left, right) => score(right) - score(left)).slice(0, 20);
  if (xCandidates.length === 0) lines.push('- 无可用候选。');
  for (const item of xCandidates) {
    lines.push(
      `### ${sanitizeReportValue(item.title.slice(0, 120))}`,
      '',
      `- 作者：${sanitizeReportValue(item.author_name || 'UNKNOWN')}`,
      `- 发布时间：${item.published_at ?? 'null'}`,
      `- 浏览量：${metric(item.engagement.views)}`,
      `- 点赞：${metric(item.engagement.likes)}`,
      `- 转发：${metric(item.engagement.reposts)}`,
      `- 回复：${metric(item.engagement.comments)}`,
      `- 原始链接：${sanitizeReportValue(item.canonical_url)}`,
      `- 命中查询：${sanitizeReportValue(item.query_text)}`,
      '',
    );
  }
  lines.push('## 公众号候选', '');
  if (weixinMaterials.length === 0) lines.push('- 无可用候选。');
  for (const item of weixinMaterials.slice(0, 20)) {
    lines.push(
      `### ${sanitizeReportValue(item.title.slice(0, 120))}`,
      '',
      `- 公众号名称：${sanitizeReportValue(item.author_name || 'UNKNOWN')}`,
      `- 发布时间：${item.published_at ?? 'null'}`,
      `- 可追溯原文 URL：${item.source_access_status === 'resolved' ? '是' : '否'}`,
      `- 是否下载正文：${item.content_downloaded ? '是' : '否'}`,
      `- 命中查询：${sanitizeReportValue(item.query_text)}`,
      '',
    );
  }
  lines.push('## 异常', '');
  const failures = result.platforms.filter((platform) => platform.status !== 'success');
  if (failures.length === 0) lines.push('- 无。');
  for (const platform of failures) {
    lines.push(`- ${platform.platform}: ${platform.status}${platform.error ? ` — ${sanitizeReportValue(platform.error)}` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function writeBrowserReport(repositoryRoot: string, result: BrowserPipelineResult): Promise<string> {
  const filePath = path.join(repositoryRoot, 'reports', 'browser', `${result.collection_date}.md`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, renderBrowserReport(result), 'utf8');
  return filePath;
}
