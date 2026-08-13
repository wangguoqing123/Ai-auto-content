import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hasSensitiveWeixinAccessQuery,
  normalizeWeixinArticleArtifact,
} from '../src/collectors/opencli/weixin-article-artifact.js';

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(markdown: string, extension = '.md') {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'weixin-artifact-'));
  const outputDirectory = path.join(repositoryRoot, 'data', 'weixin-articles', '2026-08-14');
  const savedPath = path.join(outputDirectory, 'article', `article${extension}`);
  roots.push(repositoryRoot);
  await mkdir(path.dirname(savedPath), { recursive: true });
  await writeFile(savedPath, markdown);
  return { repositoryRoot, outputDirectory, savedPath };
}

describe('Weixin downloaded article artifact safety', () => {
  it('returns a repository-relative POSIX path and rewrites only the top original link', async () => {
    const item = await fixture([
      '# Fixture article',
      '',
      '> 原文链接: https://mp.weixin.qq.com/s?sn=stable&signature=secret&pass_ticket=hidden&exportkey=export&sessionid=session&xsec_token=token&scene=1&src=11&from=timeline&clicktime=1&enterid=2&subscene=3&ascene=4&wx_header=1',
      '',
      'The body can use the word signature normally.',
      '原文链接: https://example.com/body-link',
      '',
    ].join('\n'));
    const contentPath = await normalizeWeixinArticleArtifact({
      ...item,
      accessUrl: 'https://mp.weixin.qq.com/s?sn=stable&signature=secret',
      canonicalUrl: 'https://mp.weixin.qq.com/s?sn=stable&signature=secret&pass_ticket=hidden&scene=1',
    });
    expect(contentPath).toBe('data/weixin-articles/2026-08-14/article/article.md');
    const cleaned = await readFile(item.savedPath, 'utf8');
    expect(cleaned).toContain('> 原文链接: https://mp.weixin.qq.com/s?sn=stable');
    expect(cleaned).toContain('word signature normally');
    expect(cleaned).toContain('原文链接: https://example.com/body-link');
    expect(cleaned).not.toMatch(/[?&](?:signature|pass_ticket|exportkey|sessionid|xsec_token|scene|src|from|clicktime|enterid|subscene|ascene|wx_header)=/);
  });

  it('removes an unstable temporary top link and keeps a dry-run diagnostic without a path', async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'weixin-dry-repository-'));
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'weixin-dry-output-'));
    const savedPath = path.join(outputDirectory, 'article.md');
    roots.push(repositoryRoot, outputDirectory);
    await writeFile(savedPath, '# Fixture\n\n原文链接: https://mp.weixin.qq.com/s?signature=secret\n\nInternal body.\n');
    expect(await normalizeWeixinArticleArtifact({
      repositoryRoot,
      outputDirectory,
      savedPath,
      accessUrl: 'https://mp.weixin.qq.com/s?signature=secret',
      canonicalUrl: null,
      persistContentPath: false,
    })).toBeNull();
    const cleaned = await readFile(savedPath, 'utf8');
    expect(cleaned).not.toContain('原文链接');
    expect(cleaned).toContain('Internal body.');
  });

  it('rejects sensitive URL query parameters while allowing the normal word signature', async () => {
    expect(hasSensitiveWeixinAccessQuery('The document signature is useful.')).toBe(false);
    expect(hasSensitiveWeixinAccessQuery('https://example.com/?signature=secret')).toBe(true);
    expect(hasSensitiveWeixinAccessQuery('https://example.com/?pass_ticket=secret')).toBe(true);
    const item = await fixture('# Fixture\n\nBody URL: https://example.com/?xsec_token=secret\n');
    await expect(normalizeWeixinArticleArtifact({
      ...item,
      accessUrl: 'https://mp.weixin.qq.com/s/stable-slug',
      canonicalUrl: 'https://mp.weixin.qq.com/s/stable-slug',
    })).rejects.toThrow('Sensitive Weixin access query');
  });

  it('rejects parent traversal, outside files, symlink escapes, and non-Markdown files', async () => {
    const item = await fixture('# Fixture\n');
    const outside = path.join(item.repositoryRoot, 'outside.md');
    await writeFile(outside, '# Outside\n');
    await expect(normalizeWeixinArticleArtifact({
      ...item, savedPath: '../outside.md',
      accessUrl: 'https://mp.weixin.qq.com/s/stable', canonicalUrl: 'https://mp.weixin.qq.com/s/stable',
    })).rejects.toThrow('parent traversal');
    for (const invalidPath of ['~/article.md', 'C:\\Users\\alice\\article.md']) {
      await expect(normalizeWeixinArticleArtifact({
        ...item, savedPath: invalidPath,
        accessUrl: 'https://mp.weixin.qq.com/s/stable', canonicalUrl: 'https://mp.weixin.qq.com/s/stable',
      })).rejects.toThrow('path is invalid');
    }
    await expect(normalizeWeixinArticleArtifact({
      ...item, savedPath: outside,
      accessUrl: 'https://mp.weixin.qq.com/s/stable', canonicalUrl: 'https://mp.weixin.qq.com/s/stable',
    })).rejects.toThrow('output directory');

    const externalOutput = await mkdtemp(path.join(os.tmpdir(), 'weixin-external-output-'));
    const externalSaved = path.join(externalOutput, 'outside.md');
    roots.push(externalOutput);
    await writeFile(externalSaved, '# External\n');
    await expect(normalizeWeixinArticleArtifact({
      ...item, outputDirectory: externalOutput, savedPath: externalSaved,
      accessUrl: 'https://mp.weixin.qq.com/s/stable', canonicalUrl: 'https://mp.weixin.qq.com/s/stable',
    })).rejects.toThrow('runtime repository');

    const link = path.join(item.outputDirectory, 'linked.md');
    await symlink(outside, link);
    await expect(normalizeWeixinArticleArtifact({
      ...item, savedPath: link,
      accessUrl: 'https://mp.weixin.qq.com/s/stable', canonicalUrl: 'https://mp.weixin.qq.com/s/stable',
    })).rejects.toThrow('output directory');

    const nonMarkdown = await fixture('not markdown\n', '.txt');
    await expect(normalizeWeixinArticleArtifact({
      ...nonMarkdown,
      accessUrl: 'https://mp.weixin.qq.com/s/stable', canonicalUrl: 'https://mp.weixin.qq.com/s/stable',
    })).rejects.toThrow('must be Markdown');
  });
});
