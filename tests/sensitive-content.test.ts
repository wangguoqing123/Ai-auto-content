import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  assertSafeBrowserDataFile,
  scanBrowserMarkdown,
  scanStructuredBrowserData,
  SensitiveBrowserDataError,
} from '../src/local-runtime/sensitive-content.js';

describe('file-aware Browser data safety scanning', () => {
  it('allows normal technical Markdown, example paths, placeholders, and external signed URLs', () => {
    const markdown = [
      '# Authentication examples',
      'Authorization header is required.',
      'Use Cookie-based sessions.',
      'No ct0 cookie was found.',
      'Write the file to /tmp/output.',
      'Example path: /home/example/project.',
      'Windows example: C:\\Users\\example\\project.',
      'https://example.com/download?signature=demo',
      'https://s3.example.com/file?signature=demo',
      'https://api.example.com/?sessionid=document-example',
      'Authorization: Bearer YOUR_TOKEN',
      'Authorization: Bearer <TOKEN>',
      'Cookie: auth_token=<TOKEN>',
    ].join('\n');
    expect(scanBrowserMarkdown('reports/browser/2026-08-14.md', markdown)).toEqual([]);
    expect(() => assertSafeBrowserDataFile('data/weixin-articles/2026-08-14/mat_x/article.md', markdown)).not.toThrow();
  });

  it.each([
    'https://mp.weixin.qq.com/s?signature=secret',
    'https://mp.weixin.qq.com/s?pass_ticket=secret',
    'https://weixin.sogou.com/link?signature=secret',
  ])('rejects temporary Weixin access URLs in Markdown: %s', (url) => {
    expect(() => assertSafeBrowserDataFile('reports/browser/2026-08-14.md', `Article: ${url}\n`))
      .toThrow(SensitiveBrowserDataError);
  });

  it.each([
    'Authorization: Bearer real-secret',
    'Cookie: auth_token=real-secret',
    'ct0=real-secret',
    'auth_token=real-secret',
  ])('rejects explicit Markdown credential assignments: %s', (credential) => {
    expect(scanBrowserMarkdown('reports/browser/2026-08-14.md', credential))
      .toContain('explicit credential assignment');
  });

  it('rejects the current home path even when it appears inside prose', () => {
    expect(scanBrowserMarkdown('reports/browser/2026-08-14.md', `Output was written under ${os.homedir()}/private.`))
      .toContain('current home directory path');
  });

  it('parses JSON and allows ordinary error strings and redacted values', () => {
    const content = JSON.stringify({
      error: 'X login failed because no ct0 cookie was found; Authorization is required; Cookie is unavailable',
      note: 'write temporary data to /tmp/output and see /home/example/project',
      documentation_url: 'https://example.com/?signature=demo',
      authorization: '[redacted]',
      cookie: '[not available]',
      content_path: 'data/weixin-articles/2026-08-14/mat_x/article/article.md',
    });
    expect(scanStructuredBrowserData('data/browser-runs/run.json', content)).toEqual([]);
  });

  it('parses JSONL line by line and ignores empty lines', () => {
    const content = [
      JSON.stringify({ content_path: null, error: 'No ct0 cookie found' }),
      '',
      JSON.stringify({ content_path: 'data/weixin-articles/2026-08-14/mat_x/article.md' }),
      '',
    ].join('\n');
    expect(scanStructuredBrowserData('data/browser-materials/2026-08-14.jsonl', content)).toEqual([]);
  });

  it.each(['authorization', 'Authorization', 'cookie', 'ct0', 'auth_token'])
    ('rejects a real structured credential under key %s', (key) => {
      const content = JSON.stringify({ nested: [{ [key]: key === 'cookie' ? 'auth_token=real-secret' : 'real-secret' }] });
      expect(() => assertSafeBrowserDataFile('data/browser-runs/run.json', content))
        .toThrow(SensitiveBrowserDataError);
    });

  it.each([
    '/Users/alice/article.md',
    '/home/alice/article.md',
    '/private/var/example/article.md',
    '/var/folders/example/article.md',
    '/Volumes/private/article.md',
    'C:\\Users\\alice\\article.md',
  ])('rejects a structured absolute path value: %s', (absolutePath) => {
    expect(() => assertSafeBrowserDataFile('data/browser-runs/run.json', JSON.stringify({ output: absolutePath })))
      .toThrow(SensitiveBrowserDataError);
  });

  it.each(['/Users/alice/article.md', '../article.md', '~/article.md', 'C:\\Users\\alice\\article.md'])
    ('rejects invalid content_path: %s', (contentPath) => {
      expect(() => assertSafeBrowserDataFile('data/browser-materials/2026-08-14.jsonl', JSON.stringify({ content_path: contentPath })))
        .toThrow(SensitiveBrowserDataError);
    });

  it('allows null and repository-relative Weixin content_path values', () => {
    expect(() => assertSafeBrowserDataFile(
      'data/browser-materials/2026-08-14.jsonl',
      `${JSON.stringify({ content_path: null })}\n${JSON.stringify({ content_path: 'data/weixin-articles/2026-08-14/mat_x/article/article.md' })}\n`,
    )).not.toThrow();
  });

  it('rejects malformed JSON and any malformed non-empty JSONL line', () => {
    expect(() => assertSafeBrowserDataFile('data/browser-runs/run.json', '{not json}')).toThrow('invalid JSON');
    expect(() => assertSafeBrowserDataFile('data/browser-materials/2026-08-14.jsonl', '{}\nnot json\n'))
      .toThrow('invalid JSONL at line 2');
  });

  it('rejects temporary Weixin URLs in structured strings but allows external signed URLs', () => {
    expect(() => assertSafeBrowserDataFile('data/browser-runs/run.json', JSON.stringify({
      urls: [
        'https://example.com/file?signature=demo',
        'https://api.example.com/?sessionid=document-example',
      ],
    }))).not.toThrow();
    expect(() => assertSafeBrowserDataFile('data/browser-runs/run.json', JSON.stringify({
      url: 'https://mp.weixin.qq.com/s?pass_ticket=secret',
    }))).toThrow(SensitiveBrowserDataError);
  });
});
