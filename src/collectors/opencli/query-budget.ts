export interface PlatformQuery {
  id: string;
  query: string;
  enabled: boolean;
  priority?: number;
}

export function selectRotatedQueries<T extends PlatformQuery>(queries: T[], maximum: number, date: Date): T[] {
  if (!Number.isInteger(maximum) || maximum < 1) return [];
  const enabled = queries
    .filter((query) => query.enabled)
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id));
  if (enabled.length <= maximum) return enabled;
  const dayNumber = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
  const offset = dayNumber % enabled.length;
  const rotated = [...enabled.slice(offset), ...enabled.slice(0, offset)];
  return rotated.slice(0, maximum);
}
