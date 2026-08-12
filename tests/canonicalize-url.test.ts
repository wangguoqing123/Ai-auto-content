import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from '../src/processors/canonicalize-url.js';

describe('canonicalizeUrl', () => {
  it('removes fragments, tracking parameters and trailing slashes', () => {
    expect(canonicalizeUrl(
      'HTTPS://Example.COM/Article///?utm_source=newsletter&b=2&ref=home&a=1#section',
    )).toBe('https://example.com/Article?a=1&b=2');
  });

  it('retains query parameters that can affect page content', () => {
    expect(canonicalizeUrl('https://example.com/search/?page=2&q=ai&utm_campaign=x'))
      .toBe('https://example.com/search?page=2&q=ai');
  });

  it('safely returns malformed input without throwing', () => {
    expect(canonicalizeUrl('  not a url # fragment  ')).toBe('not a url # fragment');
  });
});
