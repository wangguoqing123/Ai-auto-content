import { describe, expect, it } from 'vitest';
import { Deduplicator } from '../src/processors/deduplicate.js';
import { createContentFingerprint, createUrlFingerprint } from '../src/processors/fingerprint.js';

function candidate(url: string, title: string, excerpt: string) {
  return {
    urlFingerprint: createUrlFingerprint(url),
    contentFingerprint: createContentFingerprint(title, excerpt),
  };
}

describe('Deduplicator', () => {
  it('rejects the same canonical URL', () => {
    const deduplicator = new Deduplicator();
    expect(deduplicator.checkAndAdd(candidate('https://example.com/a', 'First', 'One'))).toBe('unique');
    expect(deduplicator.checkAndAdd(candidate('https://example.com/a', 'Changed', 'Two'))).toBe('duplicate_url');
  });

  it('rejects different URLs with normalized identical content', () => {
    const deduplicator = new Deduplicator();
    expect(deduplicator.checkAndAdd(candidate('https://example.com/a', 'AI Guide', 'Try this workflow'))).toBe('unique');
    expect(deduplicator.checkAndAdd(candidate('https://mirror.example/a', 'ai guide!', 'Try  this workflow.')))
      .toBe('duplicate_content');
  });

  it('uses persisted state for cross-day deduplication', () => {
    const firstDay = new Deduplicator();
    const item = candidate('https://example.com/a', 'AI Guide', 'Try this workflow');
    firstDay.checkAndAdd(item);
    const secondDay = new Deduplicator(firstDay.toState('2026-08-12T01:00:00.000Z'));
    expect(secondDay.checkAndAdd(item)).toBe('duplicate_url');
  });
});
