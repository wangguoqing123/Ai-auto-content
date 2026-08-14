import { describe, expect, it, vi } from 'vitest';
import { defaultPublicResolver, isPublicInternetAddress, resolveAndValidatePublicUrl } from '../src/research/url-safety.js';
import { fetchPublicSource } from '../src/research/source-fetcher.js';
import { loadResearchIntelligenceConfig } from '../src/research/config.js';

describe('research URL safety', () => {
  it.each([
    '127.0.0.1', '0.0.0.0', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '224.0.0.1', '240.0.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1',
    '::1', 'fe80::1', 'fc00::1', 'ff02::1', '::', '::ffff:127.0.0.1',
  ])('rejects non-public or reserved address %s', (address) => {
    expect(isPublicInternetAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts public unicast address %s', (address) => {
    expect(isPublicInternetAddress(address)).toBe(true);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/file',
    'data:text/plain,hello',
    'javascript:alert(1)',
  ])('rejects protocol in %s', async (url) => {
    await expect(resolveAndValidatePublicUrl(url, async () => [{ address: '8.8.8.8', family: 4 }])).rejects.toMatchObject({ code: 'unsupported_protocol' });
  });

  it('rejects localhost names before DNS', async () => {
    const resolver = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]);
    await expect(resolveAndValidatePublicUrl('https://localhost/path', resolver)).rejects.toMatchObject({ code: 'localhost_forbidden' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects username and password URLs', async () => {
    await expect(resolveAndValidatePublicUrl('https://user:pass@example.com/', async () => [{ address: '8.8.8.8', family: 4 }]))
      .rejects.toMatchObject({ code: 'url_credentials_forbidden' });
  });

  it.each(['https://example.com:444/', 'http://example.com:8080/'])('rejects non-standard port %s', async (url) => {
    await expect(resolveAndValidatePublicUrl(url, async () => [{ address: '8.8.8.8', family: 4 }]))
      .rejects.toMatchObject({ code: 'port_forbidden' });
  });

  it.each(['https://example.com:443/', 'http://example.com:80/'])('allows explicit standard port %s', async (url) => {
    await expect(resolveAndValidatePublicUrl(url, async () => [{ address: '8.8.8.8', family: 4 }])).resolves.toBeDefined();
  });

  it('rejects a hostname when any DNS answer is private', async () => {
    await expect(resolveAndValidatePublicUrl('https://example.com/', async () => [
      { address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 },
    ])).rejects.toMatchObject({ code: 'non_public_address' });
  });

  it('allows a hostname only when every DNS answer is public', async () => {
    const result = await resolveAndValidatePublicUrl('https://example.com/', async () => [
      { address: '8.8.8.8', family: 4 }, { address: '1.1.1.1', family: 4 },
    ]);
    expect(result.addresses).toHaveLength(2);
  });

  it('resolves the live Topic source host through the pinned public resolver only in an explicit live test', async () => {
    if (process.env.RESEARCH_LIVE_DNS_TEST !== '1') return;
    const addresses = await defaultPublicResolver('openai.com');
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.every(({ address }) => isPublicInternetAddress(address))).toBe(true);
  });

  it('revalidates DNS for each redirect and returns the final URL', async () => {
    const config = await loadResearchIntelligenceConfig(process.cwd());
    const resolve = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]);
    const request = vi.fn()
      .mockResolvedValueOnce({ statusCode: 302, location: 'https://final.example/path', contentType: '', body: Buffer.alloc(0) })
      .mockResolvedValueOnce({ statusCode: 200, location: null, contentType: 'text/plain; charset=utf-8', body: Buffer.from('ok') });
    const result = await fetchPublicSource('https://start.example/', config.source_fetch, { resolveHostname: resolve, request });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(result.finalUrl).toBe('https://final.example/path');
  });

  it('rejects a redirect whose DNS answer becomes private', async () => {
    const config = await loadResearchIntelligenceConfig(process.cwd());
    const resolve = vi.fn()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    const request = vi.fn().mockResolvedValue({
      statusCode: 302, location: 'http://metadata.example/latest', contentType: '', body: Buffer.alloc(0),
    });
    await expect(fetchPublicSource('https://start.example/', config.source_fetch, { resolveHostname: resolve, request }))
      .rejects.toMatchObject({ code: 'non_public_address' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect chain over the configured maximum', async () => {
    const config = structuredClone(await loadResearchIntelligenceConfig(process.cwd()));
    config.source_fetch.maximum_redirects = 1;
    const request = vi.fn().mockResolvedValue({ statusCode: 302, location: '/again', contentType: '', body: Buffer.alloc(0) });
    await expect(fetchPublicSource('https://example.com/start', config.source_fetch, {
      resolveHostname: async () => [{ address: '8.8.8.8', family: 4 }], request,
    })).rejects.toMatchObject({ code: 'too_many_redirects' });
  });

  it('marks unsupported content types without returning a body', async () => {
    const config = await loadResearchIntelligenceConfig(process.cwd());
    await expect(fetchPublicSource('https://example.com/file.pdf', config.source_fetch, {
      resolveHostname: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => ({ statusCode: 200, location: null, contentType: 'application/pdf', body: Buffer.from('pdf') }),
    })).rejects.toMatchObject({ code: 'unsupported_content_type' });
  });

  it.each([
    [403, Buffer.from('<html><title>Forbidden</title></html>')],
    [200, Buffer.from('<html><title>Just a moment...</title><p>Enable JavaScript and cookies to continue</p></html>')],
  ])('classifies HTTP %s access control as canonical_access_blocked', async (statusCode, body) => {
    const config = await loadResearchIntelligenceConfig(process.cwd());
    await expect(fetchPublicSource('https://openai.com/index/example', config.source_fetch, {
      resolveHostname: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => ({ statusCode, location: null, contentType: 'text/html', body }),
    })).rejects.toMatchObject({ code: 'canonical_access_blocked', httpStatus: statusCode });
  });

  it('returns no Set-Cookie or Authorization metadata', async () => {
    const config = await loadResearchIntelligenceConfig(process.cwd());
    const result = await fetchPublicSource('https://example.com/', config.source_fetch, {
      resolveHostname: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => ({ statusCode: 200, location: null, contentType: 'text/plain', body: Buffer.from('safe') }),
    });
    expect(Object.keys(result).sort()).toEqual(['body', 'contentType', 'finalUrl', 'retrievedAt']);
  });
});
