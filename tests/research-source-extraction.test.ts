import http from 'node:http';
import { mkdtemp, readFile, rm, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanResearchCache, writeResearchCacheSnapshot } from '../src/research/cache.js';
import { extractCleanSource } from '../src/research/html-extractor.js';
import { requestOnce } from '../src/research/source-fetcher.js';
import { researchSourceManifestSchema } from '../src/research/schemas.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function extract(body: string, contentType = 'text/html', maximumCleanTextChars = 80_000) {
  return extractCleanSource({
    sourceId: 'source_111111111111',
    materialId: 'mat_111111111111',
    body: Buffer.from(body),
    contentType,
    finalUrl: 'https://example.com/article',
    fallbackTitle: 'Fallback title',
    fallbackAuthor: 'Fallback author',
    retrievedAt: '2026-08-14T00:00:00.000Z',
    maximumCleanTextChars,
  });
}

describe('research source extraction and cache', () => {
  it('removes scripts, navigation, footer, ads, and cookie banners', () => {
    const snapshot = extract(`<!doctype html><html><head><title>Safe title</title><meta name="author" content="Official"></head><body>
      <nav>navigation secret</nav><article><h2>Work mode</h2><p>Keep this paragraph.</p><script>ignore me</script>
      <div class="advertisement"><p>ad text</p></div><div class="cookie-banner"><p>cookie text</p></div><p>Keep the second paragraph.</p></article>
      <footer>footer text</footer></body></html>`);
    expect(snapshot.title).toBe('Safe title');
    expect(snapshot.author).toBe('Official');
    expect(snapshot.segments.map(({ text }) => text)).toEqual(['Keep this paragraph.', 'Keep the second paragraph.']);
    expect(snapshot.segments.every(({ heading }) => heading === 'Work mode')).toBe(true);
  });

  it('assigns stable paragraph IDs and order', () => {
    const snapshot = extract('<main><p>First.</p><p>Second.</p><p>Third.</p></main>');
    expect(snapshot.segments.map(({ segment_id }) => segment_id)).toEqual(['p0001', 'p0002', 'p0003']);
    expect(snapshot.segments.map(({ text }) => text)).toEqual(['First.', 'Second.', 'Third.']);
  });

  it('produces a stable content hash for equivalent extraction', () => {
    const first = extract('<main><p>Stable   text.</p></main>');
    const second = extract('<main><p>Stable text.</p></main>');
    expect(first.content_sha256).toBe(second.content_sha256);
  });

  it('normalizes plain text into numbered paragraphs', () => {
    const snapshot = extract('First paragraph.\n\nSecond paragraph.', 'text/plain');
    expect(snapshot.segments.map(({ text }) => text)).toEqual(['First paragraph.', 'Second paragraph.']);
  });

  it('caps the total committed clean text', () => {
    const snapshot = extract(`<main><p>${'a'.repeat(900)}</p><p>${'b'.repeat(900)}</p></main>`, 'text/html', 1_000);
    expect(snapshot.segments.reduce((sum, segment) => sum + segment.text.length, 0)).toBe(1_000);
  });

  it('splits an oversized paragraph into bounded segments', () => {
    const snapshot = extract(`<main><p>${'a'.repeat(8_500)}</p></main>`);
    expect(snapshot.segments.length).toBe(3);
    expect(Math.max(...snapshot.segments.map(({ text }) => text.length))).toBeLessThanOrEqual(4_000);
  });

  it('rejects an empty source after cleaning', () => {
    expect(() => extract('<html><body><script>only code</script><nav>only nav</nav></body></html>')).toThrow(/extractable text/);
  });

  it('rejects a single committed quote over 500 characters', () => {
    expect(researchSourceManifestSchema.safeParse({
      source_id: 'source_111111111111', material_id: 'mat_111111111111', canonical_url: 'https://example.com',
      final_url: 'https://example.com', title: 'Title', author: '', retrieved_at: '2026-08-14T00:00:00.000Z',
      content_type: 'text/plain', content_sha256: 'a'.repeat(64), fetch_status: 'success',
      selected_quotes: [{ claim_id: 'claim_x', segment_id: 'p0001', quote: 'x'.repeat(501) }], error_code: null,
    }).success).toBe(false);
  });

  it('rejects total committed source quotes over 1500 characters', () => {
    expect(researchSourceManifestSchema.safeParse({
      source_id: 'source_111111111111', material_id: 'mat_111111111111', canonical_url: 'https://example.com',
      final_url: 'https://example.com', title: 'Title', author: '', retrieved_at: '2026-08-14T00:00:00.000Z',
      content_type: 'text/plain', content_sha256: 'a'.repeat(64), fetch_status: 'success',
      selected_quotes: [1, 2, 3, 4].map((index) => ({ claim_id: `claim_${index}`, segment_id: `p000${index}`, quote: 'x'.repeat(400) })),
      error_code: null,
    }).success).toBe(false);
  });

  it('writes cache directory 0700 and snapshot file 0600 outside the repository', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'research-cache-test-'));
    roots.push(root);
    const cache = path.join(root, 'private-cache');
    const snapshot = extract('<main><p>Cached clean paragraph.</p></main>');
    const file = await writeResearchCacheSnapshot(cache, snapshot);
    expect((await stat(cache)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ content_sha256: snapshot.content_sha256 });
  });

  it('cleans only cache entries older than the configured retention', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'research-cache-clean-'));
    roots.push(root);
    const cache = path.join(root, 'cache');
    const first = await writeResearchCacheSnapshot(cache, extract('<main><p>Old.</p></main>'));
    const second = await writeResearchCacheSnapshot(cache, extract('<main><p>New.</p></main>'));
    await utimes(first, new Date('2026-08-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'));
    await utimes(second, new Date('2026-08-13T00:00:00Z'), new Date('2026-08-13T00:00:00Z'));
    expect(await cleanResearchCache(cache, 7, new Date('2026-08-14T00:00:00Z'))).toBe(1);
    await expect(stat(first)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(second)).resolves.toBeDefined();
  });

  it('rejects a response that declares too many bytes', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Length': '100' });
      response.end('small');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    try {
      if (address === null || typeof address === 'string') throw new Error('Missing server address');
      await expect(requestOnce(new URL(`http://example.test:${address.port}/`), [{ address: '127.0.0.1', family: 4 }], 1_000, 10))
        .rejects.toMatchObject({ code: 'response_too_large' });
    } finally {
      server.close();
    }
  });

  it('rejects a streamed response that exceeds the byte cap', async () => {
    const server = http.createServer((_request, response) => response.end('x'.repeat(100)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    try {
      if (address === null || typeof address === 'string') throw new Error('Missing server address');
      await expect(requestOnce(new URL(`http://example.test:${address.port}/`), [{ address: '127.0.0.1', family: 4 }], 1_000, 10))
        .rejects.toMatchObject({ code: 'response_too_large' });
    } finally {
      server.close();
    }
  });
});
