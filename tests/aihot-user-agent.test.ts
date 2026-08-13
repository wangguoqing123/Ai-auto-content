import { describe, expect, it } from 'vitest';
import {
  buildAihotUserAgent,
  DEFAULT_AIHOT_USER_AGENT,
  isUuidV4,
} from '../src/collectors/aihot/user-agent.js';

describe('AIHOT User-Agent', () => {
  it('uses the project identity when no Actor UUID is configured', () => {
    expect(buildAihotUserAgent()).toBe(DEFAULT_AIHOT_USER_AGENT);
    expect(DEFAULT_AIHOT_USER_AGENT).toBe(
      'AI-Auto-Content/0.2 (+https://github.com/wangguoqing123/Ai-auto-content)',
    );
  });

  it('appends a valid UUID v4 Actor identifier', () => {
    const actorId = '123e4567-e89b-42d3-a456-426614174000';
    expect(isUuidV4(actorId)).toBe(true);
    expect(buildAihotUserAgent({ actorId })).toBe(`${DEFAULT_AIHOT_USER_AGENT} aihot-actor/${actorId}`);
  });

  it('accepts every legal UUID v4 variant nibble', () => {
    expect(isUuidV4('123e4567-e89b-42d3-8456-426614174000')).toBe(true);
    expect(isUuidV4('123e4567-e89b-42d3-b456-426614174000')).toBe(true);
  });

  it('ignores non-v4 and malformed Actor identifiers', () => {
    expect(isUuidV4('123e4567-e89b-12d3-a456-426614174000')).toBe(false);
    expect(isUuidV4('not-a-uuid')).toBe(false);
    expect(buildAihotUserAgent({ actorId: 'not-a-uuid' })).toBe(DEFAULT_AIHOT_USER_AGENT);
  });

  it('emits only a generic configuration warning for an invalid Actor identifier', () => {
    const actorId = 'sensitive-invalid-actor-value';
    const warnings: string[] = [];
    expect(buildAihotUserAgent({ actorId, onInvalidActorId: (message) => warnings.push(message) }))
      .toBe(DEFAULT_AIHOT_USER_AGENT);
    expect(warnings).toEqual(['Ignoring invalid AIHOT_ACTOR_ID; expected a UUID v4.']);
    expect(warnings[0]).not.toContain(actorId);
  });
});
