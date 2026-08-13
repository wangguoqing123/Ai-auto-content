const NOTE_PATH = /^\/(?:search_result|explore|note)\/([0-9a-f]{24})(?:\/)?$/i;

function parseXiaohongshuUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)xiaohongshu\.com$/i.test(url.hostname)) {
    throw new Error('Invalid Xiaohongshu URL');
  }
  if (!NOTE_PATH.test(url.pathname)) throw new Error('Xiaohongshu URL does not contain a note ID');
  return url;
}

export function deriveXiaohongshuNoteId(rawUrl: string): string {
  return parseXiaohongshuUrl(rawUrl).pathname.match(NOTE_PATH)?.[1]?.toLocaleLowerCase() ?? '';
}

export function canonicalizeXiaohongshuUrl(rawUrl: string): string {
  const noteId = deriveXiaohongshuNoteId(rawUrl);
  return `https://www.xiaohongshu.com/explore/${noteId}`;
}
