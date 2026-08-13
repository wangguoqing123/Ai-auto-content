const TRACKING_PARAMETERS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
  'source',
]);

export function canonicalizeUrl(input: string): string {
  const fallback = input.trim();

  try {
    const url = new URL(fallback);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';

    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }

    const parameters = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMETERS.has(key.toLowerCase()))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        return leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue);
      });
    url.search = '';
    for (const [key, value] of parameters) url.searchParams.append(key, value);

    url.pathname = url.pathname.replace(/\/{2,}/g, '/');
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');

    const serialized = url.toString();
    return serialized.replace(/\/$/, '');
  } catch {
    return fallback;
  }
}
