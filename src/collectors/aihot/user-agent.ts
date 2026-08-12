export const DEFAULT_AIHOT_USER_AGENT = 'AI-Auto-Content/0.2 (+https://github.com/wangguoqing123/Ai-auto-content)';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AihotUserAgentOptions {
  actorId?: string | null | undefined;
  onInvalidActorId?: ((message: string) => void) | undefined;
}

export function isUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

export function buildAihotUserAgent(options: AihotUserAgentOptions = {}): string {
  const actorId = options.actorId?.trim();
  if (!actorId) return DEFAULT_AIHOT_USER_AGENT;
  if (!isUuidV4(actorId)) {
    options.onInvalidActorId?.('Ignoring invalid AIHOT_ACTOR_ID; expected a UUID v4.');
    return DEFAULT_AIHOT_USER_AGENT;
  }
  return `${DEFAULT_AIHOT_USER_AGENT} aihot-actor/${actorId.toLowerCase()}`;
}
