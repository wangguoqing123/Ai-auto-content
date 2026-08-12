import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSources } from '../src/collectors/collector-registry.js';
import { RssCollector, type MaterialCollector } from '../src/collectors/rss-collector.js';
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
});
