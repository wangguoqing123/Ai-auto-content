import https from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type ResolveHostname = (hostname: string) => Promise<ResolvedAddress[]>;

export class UnsafeResearchUrlError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'UnsafeResearchUrlError';
  }
}

function unbracket(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

export function isPublicInternetAddress(value: string): boolean {
  try {
    let address = ipaddr.parse(unbracket(value));
    if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) address = address.toIPv4Address();
    return address.range() === 'unicast';
  } catch {
    return false;
  }
}

const DOH_ADDRESS = '1.1.1.1';
const DOH_HOSTNAME = 'cloudflare-dns.com';
const DOH_MAXIMUM_BYTES = 64 * 1024;
const DOH_TIMEOUT_MS = 5_000;

interface DnsJsonAnswer {
  type?: unknown;
  data?: unknown;
}

function queryPinnedDoh(hostname: string, type: 'A' | 'AAAA'): Promise<ResolvedAddress[]> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bodyBytes = 0;
    let settled = false;
    const finishError = (message: string): void => {
      if (settled) return;
      settled = true;
      reject(new UnsafeResearchUrlError('dns_failed', message));
    };
    const request = https.request({
      hostname: DOH_ADDRESS,
      servername: DOH_HOSTNAME,
      method: 'GET',
      path: `/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
      headers: {
        Host: DOH_HOSTNAME,
        Accept: 'application/dns-json',
        'User-Agent': 'AiAutoContent-Research-DNS/1.0',
      },
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        finishError('Public DNS resolver returned an unsuccessful response.');
        return;
      }
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        bodyBytes += Buffer.byteLength(chunk);
        if (bodyBytes > DOH_MAXIMUM_BYTES) {
          response.destroy();
          finishError('Public DNS resolver response exceeded its size limit.');
          return;
        }
        body += chunk;
      });
      response.on('end', () => {
        if (settled) return;
        try {
          const parsed = JSON.parse(body) as { Status?: unknown; Answer?: unknown };
          if (parsed.Status !== 0 || (parsed.Answer !== undefined && !Array.isArray(parsed.Answer))) {
            finishError('Public DNS resolver returned an invalid answer.');
            return;
          }
          const expectedType = type === 'A' ? 1 : 28;
          const family = type === 'A' ? 4 : 6;
          const addresses = ((parsed.Answer ?? []) as DnsJsonAnswer[])
            .filter((answer) => answer.type === expectedType && typeof answer.data === 'string')
            .map((answer) => ({ address: answer.data as string, family }));
          settled = true;
          resolve(addresses);
        } catch {
          finishError('Public DNS resolver returned malformed JSON.');
        }
      });
      response.on('error', () => finishError('Public DNS resolver response failed.'));
    });
    request.setTimeout(DOH_TIMEOUT_MS, () => request.destroy(new Error('DNS timeout')));
    request.on('error', () => finishError('Public DNS resolver request failed.'));
    request.end();
  });
}

export const defaultPublicResolver: ResolveHostname = async (hostname) => {
  const [ipv4, ipv6] = await Promise.all([
    queryPinnedDoh(hostname, 'A'),
    queryPinnedDoh(hostname, 'AAAA'),
  ]);
  return [...ipv4, ...ipv6];
};

export interface ValidatedPublicUrl {
  url: URL;
  addresses: ResolvedAddress[];
}

export async function resolveAndValidatePublicUrl(
  input: string | URL,
  resolveHostname: ResolveHostname = defaultPublicResolver,
): Promise<ValidatedPublicUrl> {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.toString()) : new URL(input);
  } catch {
    throw new UnsafeResearchUrlError('invalid_url', 'Source URL is invalid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeResearchUrlError('unsupported_protocol', 'Only HTTP and HTTPS source URLs are allowed.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new UnsafeResearchUrlError('url_credentials_forbidden', 'Source URLs cannot contain credentials.');
  }
  const expectedPort = url.protocol === 'https:' ? '443' : '80';
  if (url.port !== '' && url.port !== expectedPort) {
    throw new UnsafeResearchUrlError('port_forbidden', 'Only ports 80 and 443 are allowed.');
  }
  const hostname = unbracket(url.hostname).toLocaleLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UnsafeResearchUrlError('localhost_forbidden', 'Localhost source URLs are forbidden.');
  }
  let addresses: ResolvedAddress[];
  if (isIP(hostname) !== 0) {
    addresses = [{ address: hostname, family: isIP(hostname) }];
  } else {
    try {
      addresses = await resolveHostname(hostname);
    } catch {
      throw new UnsafeResearchUrlError('dns_failed', 'Source hostname could not be resolved.');
    }
  }
  if (addresses.length === 0) throw new UnsafeResearchUrlError('dns_empty', 'Source hostname returned no addresses.');
  if (addresses.some(({ address }) => !isPublicInternetAddress(address))) {
    throw new UnsafeResearchUrlError('non_public_address', 'Source hostname resolves to a non-public or reserved address.');
  }
  return { url, addresses };
}
