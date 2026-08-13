import { createHash } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function normalizeFingerprintText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function createUrlFingerprint(canonicalUrl: string): string {
  return sha256(canonicalUrl);
}

export function createContentFingerprint(title: string, excerpt: string): string {
  return sha256(`${normalizeFingerprintText(title)}\n${normalizeFingerprintText(excerpt)}`);
}
