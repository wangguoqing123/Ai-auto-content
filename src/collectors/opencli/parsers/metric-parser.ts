export function parseMetric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLocaleLowerCase().replace(/,/g, '');
  if (!normalized || /^(?:-|—|n\/a|unavailable|赞|收藏|评论)$/.test(normalized)) return null;
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*(万|w|千|k|m)?\+?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  const multiplier = match[2] === '万' || match[2]?.toLocaleLowerCase() === 'w'
    ? 10_000
    : match[2] === '千' || match[2]?.toLocaleLowerCase() === 'k'
      ? 1_000
      : match[2]?.toLocaleLowerCase() === 'm'
        ? 1_000_000
        : 1;
  return Number.isFinite(number) ? Math.round(number * multiplier) : null;
}

export function metricWhenPresent(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return parseMetric(row[key]);
  }
  return null;
}
