import { describe, expect, it } from 'vitest';
import {
  createContentFingerprint,
  createUrlFingerprint,
} from '../src/processors/fingerprint.js';

describe('fingerprints', () => {
  it('creates a deterministic SHA-256 URL fingerprint', () => {
    const fingerprint = createUrlFingerprint('https://example.com/article');
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).toBe(createUrlFingerprint('https://example.com/article'));
  });

  it('normalizes title and excerpt before creating a content fingerprint', () => {
    expect(createContentFingerprint('Hello, AI!', ' A practical  GUIDE. '))
      .toBe(createContentFingerprint('hello ai', 'a practical guide'));
  });
});
