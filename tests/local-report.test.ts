import { describe, expect, it } from 'vitest';
import type { BrowserPipelineResult } from '../src/browser-pipeline.js';
import { renderBrowserReport, sanitizeReportValue } from '../src/local-runtime/report.js';
import { browserMaterial, platformResult } from './opencli-test-helpers.js';

function reportResult(): BrowserPipelineResult {
  const x = browserMaterial({
    sourcePlatform: 'twitter', engagement: { views: null, likes: null, reposts: null, comments: null },
  });
  const unresolved = browserMaterial({
    sourcePlatform: 'weixin', collector: 'opencli-weixin-search', sourceItemId: 'article-1',
    sourceUrl: 'https://weixin.sogou.com/link', canonicalUrl: 'https://weixin.sogou.com/link',
    sourceAccessStatus: 'unresolved', status: 'quarantined', rejectionReasons: ['unresolved_source_url'],
    engagement: {}, contentDownloaded: false, authorName: '',
  });
  const downloaded = browserMaterial({
    sourcePlatform: 'weixin', collector: 'opencli-weixin', sourceItemId: 'article-2',
    sourceUrl: 'https://mp.weixin.qq.com/s/article-2', canonicalUrl: 'https://mp.weixin.qq.com/s/article-2',
    contentDownloaded: true, authorName: '示例公众号', engagement: {},
  });
  return {
    run_id: 'browser_20260814080000', collection_date: '2026-08-14', dry_run: false,
    started_at: '2026-08-14T00:00:00.000Z', finished_at: '2026-08-14T00:00:05.000Z',
    preflight: { args: ['doctor'], status: 'success', exit_code: 0, duration_ms: 1, timed_out: false, cancelled: false, error: null },
    status: 'success',
    platforms: [platformResult('twitter', [x]), platformResult('weixin', [unresolved, downloaded])],
    raw_materials_count: 3, materials_count: 3, duplicate_materials_count: 0,
  };
}

describe('Browser daily report', () => {
  it('contains only the X and official-account candidate sections', () => {
    const report = renderBrowserReport(reportResult());
    expect(report).toContain('## X 候选');
    expect(report).toContain('## 公众号候选');
    expect(report).not.toContain('小红书');
  });

  it('counts downloaded and unresolved Weixin records accurately', () => {
    const report = renderBrowserReport(reportResult());
    expect(report).toContain('公众号原文解析成功数：1');
    expect(report).toContain('公众号 unresolved / quarantined 数量：1');
  });

  it('keeps unavailable engagement as null', () => {
    const report = renderBrowserReport(reportResult());
    expect(report).toContain('浏览量：null');
    expect(report).toContain('点赞：null');
  });

  it('redacts sensitive URL parameters and local user paths', () => {
    const value = sanitizeReportValue('https://example.com/?pass_ticket=secret /Users/alice/file');
    expect(value).not.toMatch(/secret|\/Users\/alice/);
  });
});
