import type { UnifiedMaterial } from '../types.js';

const engagementFields = ['views', 'likes', 'comments', 'shares', 'reposts', 'quotes', 'bookmarks', 'collects'] as const;

function nonEmpty(value: string): boolean {
  return value.trim() !== '';
}

function usableCanonical(material: UnifiedMaterial): boolean {
  if (!nonEmpty(material.canonical_url) || material.source_access_status !== 'resolved') return false;
  try {
    const url = new URL(material.canonical_url);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function materialIdentityAliases(material: UnifiedMaterial): string[] {
  return [
    ...(nonEmpty(material.source_item_id) ? [`item:${material.source_platform}:${material.source_item_id}`] : []),
    ...(usableCanonical(material) ? [`url:${material.source_platform}:${material.canonical_url}`] : []),
    `id:${material.material_id}`,
  ];
}

export function buildStableMaterialIdentity(material: UnifiedMaterial): string {
  return materialIdentityAliases(material)[0] ?? `id:${material.material_id}`;
}

function snapshotIdentityKeys(material: UnifiedMaterial): string[] {
  return [
    ...materialIdentityAliases(material),
    ...material.identity_aliases.map((alias) => `alias:${material.source_platform}:${alias}`),
  ];
}

function qualityRank(material: UnifiedMaterial): number {
  return material.published_at_quality === 'exact' ? 2 : material.published_at_quality === 'inferred' ? 1 : 0;
}

function informationScore(material: UnifiedMaterial): number {
  return (nonEmpty(material.title) ? material.title.length : 0)
    + (nonEmpty(material.excerpt) ? material.excerpt.length : 0)
    + (material.source_access_status === 'resolved' ? 500 : 0)
    + (material.status === 'accepted' ? 250 : 0);
}

function stableSnapshotText(material: UnifiedMaterial): string {
  return JSON.stringify(material);
}

function newestFirst(left: UnifiedMaterial, right: UnifiedMaterial): number {
  const collected = Date.parse(right.collected_at) - Date.parse(left.collected_at);
  if (collected !== 0) return collected;
  const quality = qualityRank(right) - qualityRank(left);
  if (quality !== 0) return quality;
  const information = informationScore(right) - informationScore(left);
  if (information !== 0) return information;
  return stableSnapshotText(left).localeCompare(stableSnapshotText(right));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(nonEmpty))].sort();
}

function mergeGroup(group: UnifiedMaterial[]): UnifiedMaterial {
  const snapshots = [...group].sort(newestFirst);
  const latest = snapshots[0];
  if (latest === undefined) throw new Error('Cannot merge an empty material snapshot group');
  const bestPublication = [...snapshots]
    .filter((material) => material.published_at !== null)
    .sort((left, right) => qualityRank(right) - qualityRank(left) || newestFirst(left, right))[0];
  const resolved = snapshots.find((material) => material.source_access_status === 'resolved');
  const queryIds = uniqueSorted(snapshots.map(({ query_id }) => query_id));
  const queryTexts = uniqueSorted(snapshots.map(({ query_text }) => query_text));
  const aliases = uniqueSorted(snapshots.flatMap((material) => [...material.identity_aliases, ...materialIdentityAliases(material)]));
  const engagement = { ...latest.engagement };
  for (const field of engagementFields) {
    engagement[field] = snapshots.find((material) => material.engagement[field] !== null)?.engagement[field] ?? null;
  }
  const latestTitle = snapshots.find(({ title }) => nonEmpty(title))?.title ?? latest.title;
  const latestExcerpt = snapshots.find(({ excerpt }) => nonEmpty(excerpt))?.excerpt ?? latest.excerpt;
  return {
    ...latest,
    material_id: uniqueSorted(snapshots.map(({ material_id }) => material_id))[0] ?? latest.material_id,
    query_id: queryIds.join('|'),
    query_text: queryTexts.join(' | '),
    identity_aliases: aliases,
    source_access_status: resolved === undefined ? latest.source_access_status : 'resolved',
    status: resolved?.status ?? latest.status,
    canonical_url: resolved?.canonical_url ?? latest.canonical_url,
    source_url: resolved?.source_url ?? latest.source_url,
    content_downloaded: snapshots.some(({ content_downloaded }) => content_downloaded),
    content_path: snapshots.find(({ content_path }) => content_path !== null)?.content_path ?? null,
    author_followers: snapshots.find(({ author_followers }) => author_followers !== null)?.author_followers ?? null,
    title: latestTitle,
    excerpt: latestExcerpt,
    published_at: bestPublication?.published_at ?? null,
    published_at_quality: bestPublication?.published_at_quality ?? 'unknown',
    engagement,
    rejection_reasons: uniqueSorted(snapshots.flatMap(({ rejection_reasons }) => rejection_reasons)),
  };
}

/** Merge snapshots by any stable alias, including transitive alias overlap. */
export function mergeMaterialSnapshots(materials: UnifiedMaterial[]): UnifiedMaterial[] {
  const parents = materials.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parents[current] !== current) current = parents[current] ?? current;
    while (parents[index] !== index) {
      const next = parents[index] ?? index;
      parents[index] = current;
      index = next;
    }
    return current;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };
  const aliasOwner = new Map<string, number>();
  materials.forEach((material, index) => {
    for (const alias of snapshotIdentityKeys(material)) {
      const owner = aliasOwner.get(alias);
      if (owner === undefined) aliasOwner.set(alias, index);
      else union(index, owner);
    }
  });
  const groups = new Map<number, UnifiedMaterial[]>();
  materials.forEach((material, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), material]);
  });
  return [...groups.values()]
    .map(mergeGroup)
    .sort((left, right) => buildStableMaterialIdentity(left).localeCompare(buildStableMaterialIdentity(right)));
}
