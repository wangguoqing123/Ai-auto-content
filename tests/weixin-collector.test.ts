import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OpenCliRunResult } from '../src/collectors/opencli/opencli-runner.js';
import { OpenCliRunner } from '../src/collectors/opencli/opencli-runner.js';
import type { WeixinCollectorConfig } from '../src/collectors/opencli/platform-config.js';
import { WeixinCollector } from '../src/collectors/opencli/weixin-collector.js';
import { commandResult } from './opencli-test-helpers.js';

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function articleArtifact(content = '# Fixture article\n\n> 原文链接: https://mp.weixin.qq.com/s?signature=secret&pass_ticket=hidden\n\nBody uses the word signature normally.\n') {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'weixin-collector-'));
  const outputDirectory = path.join(repositoryRoot, 'data', 'weixin-articles', '2026-08-13');
  const savedPath = path.join(outputDirectory, 'fixture', 'article.md');
  roots.push(repositoryRoot);
  await mkdir(path.dirname(savedPath), { recursive: true });
  await writeFile(savedPath, content);
  return { repositoryRoot, outputDirectory, savedPath };
}

function config(queryCount = 1): WeixinCollectorConfig {
  return {
    max_queries_per_run: queryCount,
    max_results_per_query: 1,
    max_downloads_per_run: 1,
    queries: [
      { id: 'weixin-a', query: 'AI工具', priority: 2, enabled: true },
      { id: 'weixin-b', query: 'AI编程', priority: 1, enabled: true },
    ],
  };
}

function searchRow(signature: string) {
  return {
    rank: 1,
    page: 1,
    title: 'Fixture article',
    url: `https://weixin.sogou.com/link?url=fixture&type=2&signature=${signature}`,
    summary: 'Fixture summary',
    publish_time: '2026年8月13日 09:00',
  };
}

describe('Weixin collector live response flow', () => {
  it('quarantines a downloaded signature-only URL while retaining the internal Markdown body', async () => {
    const artifact = await articleArtifact();
    const calls: string[][] = [];
    const runner = {
      run: async (args: readonly string[]): Promise<OpenCliRunResult> => {
        calls.push([...args]);
        if (args[1] === 'search') return commandResult(args, 'success', [searchRow('search-secret')]);
        if (args[1] === 'resolve-article-url') return commandResult(args, 'success', [{
          url: 'https://mp.weixin.qq.com/s?src=11&signature=download-secret',
        }]);
        if (args[1] === 'download') return commandResult(args, 'success', [{
          title: 'Fixture article', author: 'Fixture account', publish_time: '2026年8月13日 09:01',
          status: 'success', size: '1 KB', saved: artifact.savedPath,
        }]);
        throw new Error(`Unexpected OpenCLI command: ${args.join(' ')}`);
      },
    } as unknown as OpenCliRunner;

    const result = await new WeixinCollector(
      runner, config(), artifact.outputDirectory, artifact.repositoryRoot,
    ).collect(new Date('2026-08-13T03:00:00.000Z'));

    expect(calls.map((args) => args.slice(0, 2))).toEqual([
      ['weixin', 'search'], ['weixin', 'resolve-article-url'], ['weixin', 'download'],
    ]);
    expect(calls.find((args) => args[1] === 'download')?.join(' ')).toContain('download-secret');
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0]).toMatchObject({
      collector: 'opencli-weixin',
      author_name: 'Fixture account',
      source_url: 'https://weixin.sogou.com/link',
      canonical_url: 'https://weixin.sogou.com/link',
      content_path: 'data/weixin-articles/2026-08-13/fixture/article.md',
      content_downloaded: true,
      published_at: '2026-08-13T01:01:00.000Z',
      published_at_quality: 'exact',
      source_access_status: 'unresolved',
      status: 'quarantined',
      rejection_reasons: ['unresolved_source_url'],
    });
    expect(result.materials[0]?.identity_aliases).toEqual(expect.arrayContaining([
      expect.stringMatching(/^metadata:/),
    ]));
    expect(JSON.stringify(result)).not.toContain('search-secret');
    expect(JSON.stringify(result)).not.toContain('download-secret');
    const markdown = await readFile(artifact.savedPath, 'utf8');
    expect(markdown).not.toContain('原文链接');
    expect(markdown).not.toMatch(/[?&](?:signature|pass_ticket)=/);
    expect(markdown).toContain('word signature normally');
  });

  it('deduplicates the same article across queries and keeps both query sources', async () => {
    const artifact = await articleArtifact();
    const calls: string[][] = [];
    const runner = { run: async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[1] === 'search') return commandResult(args, 'success', [searchRow(args[2] === 'AI工具' ? 'one' : 'two')]);
      if (args[1] === 'resolve-article-url') return commandResult(args, 'success', [{ url: 'https://mp.weixin.qq.com/s?sn=stable&signature=resolved' }]);
      if (args[1] === 'download') return commandResult(args, 'success', [{
        title: 'Fixture article', author: 'Fixture account', publish_time: '2026-08-13T01:00:00.000Z',
        status: 'success', saved: artifact.savedPath,
      }]);
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    } } as unknown as OpenCliRunner;
    const result = await new WeixinCollector(
      runner, config(2), artifact.outputDirectory, artifact.repositoryRoot,
    ).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(calls.filter((args) => args[1] === 'resolve-article-url')).toHaveLength(1);
    expect(result).toMatchObject({ raw_materials_count: 2, materials_count: 1, duplicate_materials_count: 1 });
    expect(result.materials[0]?.query_id).toBe('weixin-a,weixin-b');
    expect(result.materials[0]?.query_text).toBe('AI工具；AI编程');
  });

  it('retains the resolved search material when the article body download fails', async () => {
    const artifact = await articleArtifact();
    const runner = { run: async (args: readonly string[]) => {
      if (args[1] === 'search') return commandResult(args, 'success', [searchRow('search')]);
      if (args[1] === 'resolve-article-url') return commandResult(args, 'success', [{ url: 'https://mp.weixin.qq.com/s?sn=stable&signature=resolved' }]);
      if (args[1] === 'download') return commandResult(args, 'command_failed', null, 'article body unavailable');
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    } } as unknown as OpenCliRunner;
    const result = await new WeixinCollector(
      runner, config(), artifact.outputDirectory, artifact.repositoryRoot,
    ).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(result.status).toBe('partial_success');
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0]).toMatchObject({
      collector: 'opencli-weixin-search',
      source_url: 'https://mp.weixin.qq.com/s?sn=stable',
      source_access_status: 'resolved',
      status: 'accepted',
      content_path: null,
      content_downloaded: false,
      published_at: '2026-08-13T01:00:00.000Z',
      published_at_quality: 'exact',
    });
  });

  it('quarantines an unresolved Sogou discovery without persisting its tokenized redirect', async () => {
    const artifact = await articleArtifact();
    const runner = { run: async (args: readonly string[]) => {
      if (args[1] === 'search') return commandResult(args, 'success', [searchRow('unresolved-secret')]);
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    } } as unknown as OpenCliRunner;
    const noDownloads = { ...config(), max_downloads_per_run: 0 };
    const result = await new WeixinCollector(
      runner, noDownloads, artifact.outputDirectory, artifact.repositoryRoot,
    ).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0]).toMatchObject({
      source_url: 'https://weixin.sogou.com/link',
      canonical_url: 'https://weixin.sogou.com/link',
      source_access_status: 'unresolved',
      status: 'quarantined',
      rejection_reasons: ['unresolved_source_url'],
      content_downloaded: false,
      usage_mode: 'structure_inspiration',
      viral_confidence: 'unverified',
    });
    expect(JSON.stringify(result)).not.toContain('unresolved-secret');
  });

  it('falls back to the valid search time when the article time is unknown', async () => {
    const artifact = await articleArtifact();
    const runner = { run: async (args: readonly string[]) => {
      if (args[1] === 'search') return commandResult(args, 'success', [searchRow('search')]);
      if (args[1] === 'resolve-article-url') return commandResult(args, 'success', [{ url: 'https://mp.weixin.qq.com/s/stable-slug?signature=resolved' }]);
      if (args[1] === 'download') return commandResult(args, 'success', [{
        title: 'Fixture article', author: 'Fixture account', publish_time: 'not-a-date',
        status: 'success', saved: artifact.savedPath,
      }]);
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    } } as unknown as OpenCliRunner;
    const result = await new WeixinCollector(
      runner, config(), artifact.outputDirectory, artifact.repositoryRoot,
    ).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(result.materials[0]).toMatchObject({
      published_at: '2026-08-13T01:00:00.000Z',
      published_at_quality: 'exact',
    });
  });

  it('keeps download success but clears content_path in collector dry-run mode', async () => {
    const artifact = await articleArtifact();
    const runner = { run: async (args: readonly string[]) => {
      if (args[1] === 'search') return commandResult(args, 'success', [searchRow('search')]);
      if (args[1] === 'resolve-article-url') return commandResult(args, 'success', [{ url: 'https://mp.weixin.qq.com/s?sn=stable&signature=temporary' }]);
      if (args[1] === 'download') return commandResult(args, 'success', [{
        title: 'Fixture article', author: 'Fixture account', publish_time: '2026年8月13日 09:01',
        status: 'success', saved: artifact.savedPath,
      }]);
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    } } as unknown as OpenCliRunner;
    const result = await new WeixinCollector(
      runner, config(), artifact.outputDirectory, artifact.repositoryRoot, true,
    ).collect(new Date('2026-08-13T03:00:00.000Z'));
    expect(result.materials[0]).toMatchObject({ content_path: null, content_downloaded: true });
  });
});
