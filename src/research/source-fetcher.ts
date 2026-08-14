import http from 'node:http';
import https from 'node:https';
import type { UnifiedMaterial } from '../types.js';
import type { ResearchIntelligenceConfig } from './schemas.js';
import { extractCleanSource } from './html-extractor.js';
import { resolveAndValidatePublicUrl, type ResolveHostname } from './url-safety.js';
import { sourceIdForMaterial } from './source-materials.js';

export class ResearchSourceFetchError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ResearchSourceFetchError';
  }
}

export interface SourceFetchResponse {
  body: Buffer;
  finalUrl: string;
  contentType: string;
  retrievedAt: string;
}

export interface SourceFetchOptions {
  resolveHostname?: ResolveHostname;
  request?: typeof requestOnce;
  now?: () => Date;
}

const USER_AGENT = 'AiAutoContent-Research/1.0 (+https://github.com/wangguoqing123/Ai-auto-content)';

function mediaType(value: string | undefined): string {
  return (value ?? '').split(';', 1)[0]?.trim().toLocaleLowerCase() ?? '';
}

export async function requestOnce(
  url: URL,
  addresses: Array<{ address: string; family: number }>,
  timeoutMs: number,
  maximumBytes: number,
): Promise<{ statusCode: number; location: string | null; contentType: string; body: Buffer }> {
  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0];
  if (selected === undefined) throw new ResearchSourceFetchError('dns_empty', 'Source hostname returned no addresses.');
  return new Promise((resolve, reject) => {
    let settled = false;
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request({
      protocol: url.protocol,
      hostname: selected.address,
      family: selected.family,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      servername: url.hostname,
      headers: {
        Host: url.host,
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json,application/rss+xml,application/atom+xml',
        'Accept-Encoding': 'identity',
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const declared = Number(response.headers['content-length'] ?? 0);
      if (Number.isFinite(declared) && declared > maximumBytes) {
        settled = true;
        response.destroy();
        reject(new ResearchSourceFetchError('response_too_large', 'Source response exceeds the configured byte limit.'));
        return;
      }
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > maximumBytes) {
          settled = true;
          response.destroy();
          reject(new ResearchSourceFetchError('response_too_large', 'Source response exceeds the configured byte limit.'));
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({
          statusCode: response.statusCode ?? 0,
          location: typeof response.headers.location === 'string' ? response.headers.location : null,
          contentType: typeof response.headers['content-type'] === 'string' ? response.headers['content-type'] : '',
          body: Buffer.concat(chunks),
        });
      });
      response.on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(new ResearchSourceFetchError('network_failed', error.message.slice(0, 300)));
      });
    });
    request.setTimeout(timeoutMs, () => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(new ResearchSourceFetchError('source_timeout', 'Source request timed out.'));
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(new ResearchSourceFetchError('network_failed', error.message.slice(0, 300)));
    });
    request.end();
  });
}

export async function fetchPublicSource(
  sourceUrl: string,
  config: ResearchIntelligenceConfig['source_fetch'],
  options: SourceFetchOptions = {},
): Promise<SourceFetchResponse> {
  let current = sourceUrl;
  for (let redirects = 0; redirects <= config.maximum_redirects; redirects += 1) {
    const validated = await resolveAndValidatePublicUrl(current, options.resolveHostname);
    const response = await (options.request ?? requestOnce)(
      validated.url,
      validated.addresses,
      config.timeout_seconds * 1_000,
      config.maximum_response_bytes,
    );
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      if (response.location === null) throw new ResearchSourceFetchError('redirect_without_location', 'Source redirect has no location.');
      if (redirects >= config.maximum_redirects) throw new ResearchSourceFetchError('too_many_redirects', 'Source exceeded the redirect limit.');
      current = new URL(response.location, validated.url).toString();
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new ResearchSourceFetchError('http_error', `Source returned HTTP ${response.statusCode}.`);
    }
    const contentType = mediaType(response.contentType);
    if (!config.allowed_content_types.includes(contentType as never)) {
      throw new ResearchSourceFetchError('unsupported_content_type', `Source content type is not allowed: ${contentType || 'missing'}.`);
    }
    return {
      body: response.body,
      finalUrl: validated.url.toString(),
      contentType,
      retrievedAt: (options.now ?? (() => new Date()))().toISOString(),
    };
  }
  throw new ResearchSourceFetchError('too_many_redirects', 'Source exceeded the redirect limit.');
}

export async function fetchAndExtractMaterial(
  material: UnifiedMaterial,
  config: ResearchIntelligenceConfig,
  options: SourceFetchOptions = {},
) {
  const response = await fetchPublicSource(material.canonical_url, config.source_fetch, options);
  return extractCleanSource({
    sourceId: sourceIdForMaterial(material.material_id),
    materialId: material.material_id,
    body: response.body,
    contentType: response.contentType,
    finalUrl: response.finalUrl,
    fallbackTitle: material.title,
    fallbackAuthor: material.author_name,
    retrievedAt: response.retrievedAt,
    maximumCleanTextChars: config.source_fetch.maximum_clean_text_chars,
  });
}
