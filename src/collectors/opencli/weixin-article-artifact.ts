import { randomUUID } from 'node:crypto';
import { readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalizeWeixinArticleUrl, isTraceableWeixinCanonicalUrl, isWeixinArticleUrl } from './weixin-url.js';

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;
const SENSITIVE_ACCESS_QUERY_KEYS = new Set([
  'signature',
  'pass_ticket',
  'exportkey',
  'sessionid',
  'scene',
  'src',
  'from',
  'clicktime',
  'enterid',
  'subscene',
  'ascene',
  'wx_header',
]);
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/i;
const ORIGINAL_LINK = /^(\s*(?:>\s*)?(?:[-*]\s*)?(?:\*\*|__)?原文链接(?:\*\*|__)?\s*[:：]\s*)(.*)$/;
const TOP_METADATA = /^(?:\s*$|\s*---\s*$|\s*#{1,6}\s+.+|\s*>\s*.*|\s*(?:[-*]\s*)?(?:\*\*|__)?(?:标题|公众号|作者|发布时间|原文链接)(?:\*\*|__)?\s*[:：].*)$/;

export interface NormalizeWeixinArticleArtifactInput {
  repositoryRoot: string;
  outputDirectory: string;
  savedPath: string;
  accessUrl: string;
  canonicalUrl: string | null;
  persistContentPath?: boolean;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function rewriteTopOriginalLink(markdown: string, canonicalUrl: string | null): string {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  let inFrontmatter = lines[0]?.trim() === '---';
  let frontmatterClosed = !inFrontmatter;
  let topMetadataOpen = true;

  const rewritten = lines.flatMap((line, index) => {
    if (inFrontmatter && index > 0 && line.trim() === '---') {
      inFrontmatter = false;
      frontmatterClosed = true;
      return [line];
    }
    if (frontmatterClosed && topMetadataOpen && !TOP_METADATA.test(line)) topMetadataOpen = false;
    const match = (inFrontmatter || topMetadataOpen) ? line.match(ORIGINAL_LINK) : null;
    if (!match) return [line];
    if (!canonicalUrl) return [];
    return [`${match[1] ?? '原文链接: '}${canonicalUrl}`];
  });
  return rewritten.join(newline);
}

async function atomicRewrite(filePath: string, content: string): Promise<void> {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, 'utf8');
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export function hasSensitiveWeixinAccessQuery(value: string): boolean {
  for (const match of value.matchAll(URL_IN_TEXT)) {
    try {
      const url = new URL(match[0].replaceAll('&amp;', '&'));
      const hostname = url.hostname.toLocaleLowerCase().replace(/\.$/, '');
      const isWeixinHost = hostname === 'mp.weixin.qq.com' || hostname.endsWith('.mp.weixin.qq.com');
      const isSogouWeixinHost = hostname === 'weixin.sogou.com' || hostname.endsWith('.weixin.sogou.com');
      if (!(isWeixinHost || isSogouWeixinHost)) continue;
      if ([...url.searchParams.keys()].some((key) => SENSITIVE_ACCESS_QUERY_KEYS.has(key.toLocaleLowerCase()))) {
        return true;
      }
    } catch {
      // Ignore malformed URL-looking article text; only parsed Weixin URLs are access-query evidence.
    }
  }
  return false;
}

export async function normalizeWeixinArticleArtifact(
  input: NormalizeWeixinArticleArtifactInput,
): Promise<string | null> {
  if (!input.savedPath || input.savedPath.startsWith('~') || WINDOWS_ABSOLUTE_PATH.test(input.savedPath)) {
    throw new Error('Weixin Markdown path is invalid');
  }
  if (input.savedPath.split(/[\\/]/).includes('..')) throw new Error('Weixin Markdown path cannot contain parent traversal');
  if (!isWeixinArticleUrl(input.accessUrl)) throw new Error('Weixin access URL is invalid');

  const repositoryRoot = await realpath(input.repositoryRoot);
  const outputDirectory = await realpath(input.outputDirectory);
  const absoluteSavedPath = path.isAbsolute(input.savedPath)
    ? path.resolve(input.savedPath)
    : path.resolve(outputDirectory, input.savedPath);
  const savedPath = await realpath(absoluteSavedPath);
  if (!isInside(outputDirectory, savedPath)) throw new Error('Weixin Markdown escaped the configured output directory');
  if (!['.md', '.markdown'].includes(path.extname(savedPath).toLocaleLowerCase())) {
    throw new Error('Weixin downloaded artifact must be Markdown');
  }
  if (!(await stat(savedPath)).isFile()) throw new Error('Weixin downloaded artifact must be a file');

  let repositoryRelativePath: string | null = null;
  if (input.persistContentPath !== false) {
    const articlesRoot = await realpath(path.join(repositoryRoot, 'data', 'weixin-articles'));
    if (!isInside(articlesRoot, savedPath)) throw new Error('Weixin Markdown escaped the runtime repository');
    repositoryRelativePath = path.relative(repositoryRoot, savedPath).split(path.sep).join('/');
  }

  const traceableCanonicalUrl = input.canonicalUrl && isTraceableWeixinCanonicalUrl(input.canonicalUrl)
    ? canonicalizeWeixinArticleUrl(input.canonicalUrl)
    : null;
  const original = await readFile(savedPath, 'utf8');
  const cleaned = rewriteTopOriginalLink(original, traceableCanonicalUrl);
  if (cleaned !== original) await atomicRewrite(savedPath, cleaned);
  const verified = await readFile(savedPath, 'utf8');
  if (hasSensitiveWeixinAccessQuery(verified)) {
    throw new Error('Sensitive Weixin access query remained in downloaded Markdown');
  }

  return repositoryRelativePath;
}
