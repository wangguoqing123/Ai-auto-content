import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ACTIVE_BROWSER_PLATFORMS } from '../src/browser-pipeline.js';
import { runBrowserPipeline } from '../src/browser-pipeline.js';
import type { BrowserPlatform } from '../src/collectors/opencli/opencli-capability.js';
import { OpenCliRunner } from '../src/collectors/opencli/opencli-runner.js';
import { loadPlatformQueries } from '../src/config/load-platform-queries.js';
import { sourcePlatformSchema } from '../src/types.js';
import { commandResult } from './opencli-test-helpers.js';

describe('retired platform boundary', () => {
  it('defines exactly two active Browser platforms', () => {
    expect(ACTIVE_BROWSER_PLATFORMS).toEqual(['twitter', 'weixin']);
    expectTypeOf<BrowserPlatform>().toEqualTypeOf<'twitter' | 'weixin'>();
  });

  it('instantiates only the two default Collectors in an offline run', async () => {
    const runner = {
      run: async (args: readonly string[]) => args[0] === 'doctor'
        ? { ...commandResult(args, 'success', 'ok'), data: 'ok', stdout: 'ok' }
        : commandResult(args, 'success', []),
    } as unknown as OpenCliRunner;
    const result = await runBrowserPipeline({
      rootDir: process.cwd(), dryRun: true, runner, now: new Date('2026-08-14T00:00:00Z'),
    });
    expect(result.platforms.map((platform) => platform.platform)).toEqual(['twitter', 'weixin']);
  });

  it('loads query config containing only Twitter and Weixin', async () => {
    expect(Object.keys(await loadPlatformQueries())).toEqual(['version', 'twitter', 'weixin']);
  });

  it('rejects a retired platform added back to active query config', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'platform-config-retirement-'));
    try {
      await mkdir(path.join(root, 'config'));
      const active = await readFile(path.join(process.cwd(), 'config', 'platform-queries.yaml'), 'utf8');
      await writeFile(path.join(root, 'config', 'platform-queries.yaml'), `${active}\nxiaohongshu: { queries: [] }\n`);
      await expect(loadPlatformQueries(root)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('has no retired Collector, parser, URL helper, test, or fixture', async () => {
    const retired = [
      'src/collectors/opencli/xiaohongshu-collector.ts',
      'src/collectors/opencli/xiaohongshu-url.ts',
      'src/collectors/opencli/parsers/xiaohongshu-parser.ts',
      'tests/xiaohongshu-collector.test.ts',
      'tests/fixtures/opencli/xiaohongshu-search.json',
    ];
    for (const file of retired) await expect(access(path.join(process.cwd(), file))).rejects.toThrow();
  });

  it('does not generate retired OpenCLI commands in active source', async () => {
    const activeFiles = [
      'src/browser-pipeline.ts',
      'src/collectors/opencli/opencli-runner.ts',
      'src/collectors/opencli/platform-config.ts',
      'src/config/load-platform-queries.ts',
    ];
    for (const file of activeFiles) {
      expect(await readFile(path.join(process.cwd(), file), 'utf8')).not.toMatch(/xiaohongshu|xhs/i);
    }
  });

  it('keeps deprecated historical source-platform rows parseable', () => {
    expect(sourcePlatformSchema.parse('xiaohongshu')).toBe('xiaohongshu');
    expect(sourcePlatformSchema.options).toContain('xiaohongshu');
  });

  it('does not include the retired platform in the current adapter prompt', async () => {
    const prompt = await readFile(path.join(process.cwd(), 'prompts', '05-platform-adapter.md'), 'utf8');
    expect(prompt).not.toMatch(/小红书|xiaohongshu|xhs/i);
    expect(prompt).toContain('公众号');
    expect(prompt).toContain('X');
  });
});
