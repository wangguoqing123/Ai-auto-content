import os from 'node:os';
import { hasSensitiveWeixinAccessQuery } from '../collectors/opencli/weixin-article-artifact.js';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'ct0',
  'auth_token',
  'pass_ticket',
  'exportkey',
  'sessionid',
  'xsec_token',
]);

const ALLOWED_SECRET_PLACEHOLDERS = new Set(['[redacted]', '[not available]']);
const MARKDOWN_SECRET_PLACEHOLDERS = new Set([
  '[redacted]',
  '[not available]',
  '<token>',
  'your_token',
]);
const ABSOLUTE_PATH_VALUE = /^(?:~\/|\/(?:Users\/[^/\s]+|home\/[^/\s]+|private\/var|var\/folders|tmp|Volumes)(?:\/[^\s]*)?|[a-z]:[\\/][^\r\n]*)$/i;

export class SensitiveBrowserDataError extends Error {
  constructor(readonly filePath: string, readonly issues: string[]) {
    super(`Unsafe Browser data in ${filePath}: ${issues.join('; ')}`);
    this.name = 'SensitiveBrowserDataError';
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isAllowedStructuredSecret(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLocaleLowerCase();
    return normalized === '' || ALLOWED_SECRET_PLACEHOLDERS.has(normalized);
  }
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function isSafeContentPath(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string' || !value || value.includes('\\')) return false;
  if (value.startsWith('/') || value.startsWith('~/') || /^[a-z]:[\\/]/i.test(value)) return false;
  const parts = value.split('/');
  if (parts.includes('..') || parts.includes('.') || parts.some((part) => part === '')) return false;
  return value.startsWith('data/weixin-articles/') && value.length > 'data/weixin-articles/'.length;
}

function looksLikeAbsolutePathValue(value: string): boolean {
  return ABSOLUTE_PATH_VALUE.test(value.trim());
}

function walkStructuredValue(value: unknown, issues: string[], key = ''): void {
  if (key.toLocaleLowerCase() === 'content_path' && !isSafeContentPath(value)) {
    issues.push('content_path must be null or a repository-relative POSIX path under data/weixin-articles');
  }
  if (SENSITIVE_KEYS.has(key.toLocaleLowerCase()) && !isAllowedStructuredSecret(value)) {
    issues.push(`non-redacted value for ${key}`);
  }

  if (typeof value === 'string') {
    if (value.includes(os.homedir())) issues.push('current home directory path');
    if (hasSensitiveWeixinAccessQuery(value)) issues.push('temporary Weixin access URL');
    if (looksLikeAbsolutePathValue(value)) issues.push('absolute local path value');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStructuredValue(item, issues);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      walkStructuredValue(childValue, issues, childKey);
    }
  }
}

function parseStructuredRecords(filePath: string, content: string): unknown[] {
  if (filePath.toLocaleLowerCase().endsWith('.jsonl')) {
    return content.split(/\r?\n/).flatMap((line, index) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        throw new SensitiveBrowserDataError(filePath, [`invalid JSONL at line ${index + 1}`]);
      }
    });
  }
  try {
    return [JSON.parse(content) as unknown];
  } catch {
    throw new SensitiveBrowserDataError(filePath, ['invalid JSON']);
  }
}

export function scanStructuredBrowserData(filePath: string, content: string): string[] {
  const issues: string[] = [];
  for (const record of parseStructuredRecords(filePath, content)) walkStructuredValue(record, issues);
  return unique(issues);
}

function capturedCredentialValues(markdown: string): string[] {
  const values: string[] = [];
  const patterns = [
    /\bAuthorization\s*:\s*Bearer\s+(<[^>\r\n]+>|\[[^\]\r\n]+\]|[^\s;,\r\n]+)/gi,
    /\b(?:ct0|auth_token)\s*=\s*(<[^>\r\n]+>|\[[^\]\r\n]+\]|[^\s;,\r\n]+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value) values.push(value);
    }
  }
  return values;
}

function isMarkdownPlaceholder(value: string): boolean {
  const normalized = value.trim()
    .replace(/[.)]+$/, '')
    .replace(/^["'`]([\s\S]*)["'`]$/, '$1')
    .toLocaleLowerCase();
  return MARKDOWN_SECRET_PLACEHOLDERS.has(normalized)
    || /^(?:example_token|replace_me|token|\$token|\$\{token\})$/.test(normalized);
}

export function scanBrowserMarkdown(_filePath: string, content: string): string[] {
  const issues: string[] = [];
  if (content.includes(os.homedir())) issues.push('current home directory path');
  if (hasSensitiveWeixinAccessQuery(content)) issues.push('temporary Weixin access URL');
  if (capturedCredentialValues(content).some((value) => !isMarkdownPlaceholder(value))) {
    issues.push('explicit credential assignment');
  }
  return unique(issues);
}

/**
 * Scan untrusted material prose without treating ordinary technical discussion
 * of headers such as "Authorization" or "Cookie" as a credential leak.
 */
export function scanUntrustedMaterialText(content: string): string[] {
  const issues = scanBrowserMarkdown('', content);
  if (/\bsk-[a-z0-9_-]{12,}\b/iu.test(content)) issues.push('explicit API credential');
  const assignmentPatterns = [
    /\bCookie\s*:\s*([^\r\n]+)/giu,
    /\bsession(?:id|_id)?\s*[=:]\s*([^\s;,\r\n]+)/giu,
  ];
  for (const pattern of assignmentPatterns) {
    for (const match of content.matchAll(pattern)) {
      const value = match[1]?.trim() ?? '';
      if (value !== '' && !isMarkdownPlaceholder(value) && (/=/.test(value) || pattern.source.includes('session'))) {
        issues.push('explicit credential assignment');
      }
    }
  }
  return unique(issues);
}

function browserDataKind(filePath: string): 'structured' | 'markdown' | null {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '').toLocaleLowerCase();
  if (/^data\/browser-materials\/[^/]+\.jsonl$/.test(normalized)) return 'structured';
  if (/^data\/browser-runs\/[^/]+\.json$/.test(normalized)) return 'structured';
  if (/^reports\/browser\/[^/]+\.md$/.test(normalized)) return 'markdown';
  if (/^data\/weixin-articles\/.+\.(?:md|markdown)$/.test(normalized)) return 'markdown';
  return null;
}

export function assertSafeBrowserDataFile(filePath: string, content: string): void {
  const kind = browserDataKind(filePath);
  if (!kind) throw new SensitiveBrowserDataError(filePath, ['unsupported Browser data file type']);
  const issues = kind === 'structured'
    ? scanStructuredBrowserData(filePath, content)
    : scanBrowserMarkdown(filePath, content);
  if (issues.length > 0) throw new SensitiveBrowserDataError(filePath, issues);
}
