import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSources } from '../src/collectors/collector-registry.js';
import { RssCollector, type MaterialCollector } from '../src/collectors/rss-collector.js';
import { AihotCollector } from '../src/collectors/aihot-collector.js';
import { CloudCollector } from '../src/collectors/cloud-collector.js';
import type { SourceConfig } from '../src/types.js';
import { makeRawItem, makeSource, silentLogger } from './helpers.js';

const fixedClock = () => new Date('2026-08-12T01:00:00.000Z');

describe('RSS and Atom collection', () => {
  it.each(['rss.xml', 'atom.xml'])('parses local %s without network access', async (fixture) => {
    const xml = await readFile(path.join(process.cwd(), 'tests', 'fixtures', fixture), 'utf8');
    const collector = new RssCollector({
      timeoutMs: 15_000,
      retries: 0,
      userAgent: 'test-agent',
      fetchXml: async () => xml,
      logger: silentLogger,
    });
    const items = await collector.collect(makeSource());
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.title).toBeTruthy();
    expect(items[0]?.link).toMatch(/^https:\/\//);
  });

  it('retries a network failure twice before succeeding', async () => {
    const xml = await readFile(path.join(process.cwd(), 'tests', 'fixtures', 'rss.xml'), 'utf8');
    let attempts = 0;
    const collector = new RssCollector({
      timeoutMs: 15_000,
      retries: 2,
      retryDelayMs: 0,
      userAgent: 'test-agent',
      fetchXml: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('temporary network failure');
        return xml;
      },
      logger: silentLogger,
    });
    await expect(collector.collect(makeSource())).resolves.toHaveLength(2);
    expect(attempts).toBe(3);
  });

  it('continues other sources when one source fails', async () => {
    const sources = [makeSource({ id: 'good' }), makeSource({ id: 'bad' })];
    const collector: MaterialCollector = {
      collect: async (source: SourceConfig) => {
        if (source.id === 'bad') throw new Error('fixture failure');
        return [makeRawItem()];
      },
    };
    const results = await collectSources(sources, collector, 2, fixedClock);
    expect(results.find((result) => result.source.id === 'good')?.run.status).toBe('success');
    expect(results.find((result) => result.source.id === 'bad')?.run.status).toBe('failed');
    expect(results.find((result) => result.source.id === 'good')?.items).toHaveLength(1);
  });

  it('collects AIHOT only through the stable v1 API contract', async () => {
    const payload = JSON.parse(await readFile(path.join(process.cwd(), 'tests', 'fixtures', 'aihot-items.json'), 'utf8')) as unknown;
    const aihot = new AihotCollector({
      timeoutMs: 15_000,
      retries: 0,
      userAgent: 'AI-Auto-Content/0.2 (+https://github.com/wangguoqing123/Ai-auto-content)',
      fetchJson: async (url) => {
        expect(url).toContain('https://aihot.virxact.com/api/v1/');
        expect(url).not.toContain('/api/public/');
        return payload;
      },
      logger: silentLogger,
    });
    const source = makeSource({
      id: 'aihot',
      type: 'aihot',
      url: 'https://aihot.virxact.com/api/v1/items?mode=selected&window=24h&limit=20',
    });
    const items = await aihot.collect(source);
    expect(items[0]).toMatchObject({ guid: 'fixture-aihot-1', author: 'Fixture Source' });
  });

  it('dispatches RSS and AIHOT through the cloud collector', async () => {
    const rss = { collect: async () => [makeRawItem()] } as unknown as RssCollector;
    const aihot = { collect: async () => [makeRawItem({ guid: 'aihot' })] } as unknown as AihotCollector;
    const cloud = new CloudCollector(rss, aihot);
    await expect(cloud.collect(makeSource())).resolves.toHaveLength(1);
    await expect(cloud.collect(makeSource({ type: 'aihot' }))).resolves.toMatchObject([{ guid: 'aihot' }]);
  });
});
