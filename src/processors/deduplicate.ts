import type { NormalizedCandidate, SeenMaterials } from '../types.js';

export type DuplicateDecision = 'unique' | 'duplicate_url' | 'duplicate_content';

export class Deduplicator {
  private readonly urlFingerprints: Set<string>;
  private readonly contentFingerprints: Set<string>;

  constructor(state?: SeenMaterials) {
    this.urlFingerprints = new Set(state?.url_fingerprints ?? []);
    this.contentFingerprints = new Set(state?.content_fingerprints ?? []);
  }

  checkAndAdd(candidate: Pick<NormalizedCandidate, 'urlFingerprint' | 'contentFingerprint'>): DuplicateDecision {
    if (this.urlFingerprints.has(candidate.urlFingerprint)) return 'duplicate_url';
    if (this.contentFingerprints.has(candidate.contentFingerprint)) return 'duplicate_content';

    this.urlFingerprints.add(candidate.urlFingerprint);
    this.contentFingerprints.add(candidate.contentFingerprint);
    return 'unique';
  }

  toState(updatedAt: string | null): SeenMaterials {
    return {
      version: 1,
      url_fingerprints: [...this.urlFingerprints].sort(),
      content_fingerprints: [...this.contentFingerprints].sort(),
      updated_at: updatedAt,
    };
  }
}
