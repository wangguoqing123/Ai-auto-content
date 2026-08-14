import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { cleanedSourceSnapshotSchema, type CleanedSourceSnapshot } from './schemas.js';

export interface ExtractSourceOptions {
  sourceId: string;
  materialId: string;
  body: Buffer;
  contentType: string;
  finalUrl: string;
  fallbackTitle: string;
  fallbackAuthor: string;
  retrievedAt: string;
  maximumCleanTextChars: number;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSegment(value: string, maximum = 4_000): string[] {
  const result: string[] = [];
  let remaining = value;
  while (remaining.length > maximum) {
    const candidate = remaining.slice(0, maximum);
    const breakpoint = Math.max(candidate.lastIndexOf('。'), candidate.lastIndexOf('. '), candidate.lastIndexOf('\n'));
    const end = breakpoint >= Math.floor(maximum * 0.6) ? breakpoint + 1 : maximum;
    result.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining !== '') result.push(remaining);
  return result;
}

function plainSegments(text: string): Array<{ heading: string; text: string }> {
  return normalizeText(text).split(/\n{2,}/).flatMap((paragraph) => splitSegment(normalizeText(paragraph)))
    .filter(Boolean).map((value) => ({ heading: '', text: value }));
}

function htmlMetadata(html: string): { title: string; author: string; segments: Array<{ heading: string; text: string }> } {
  const $ = cheerio.load(html, { xmlMode: false });
  $('script,style,noscript,svg,canvas,nav,footer,aside,form,iframe,template').remove();
  $('[aria-hidden="true"],.advertisement,.advert,.ads,.cookie-banner,.cookie-consent,#cookie-banner,#cookie-consent').remove();
  const title = normalizeText(
    $('meta[property="og:title"]').attr('content')
      ?? $('meta[name="twitter:title"]').attr('content')
      ?? $('title').first().text(),
  );
  const author = normalizeText(
    $('meta[name="author"]').attr('content')
      ?? $('meta[property="article:author"]').attr('content')
      ?? '',
  );
  const root = $('article').first().length > 0
    ? $('article').first()
    : $('main').first().length > 0
      ? $('main').first()
      : $('[role="main"]').first().length > 0
        ? $('[role="main"]').first()
        : $('body').first();
  const segments: Array<{ heading: string; text: string }> = [];
  let heading = '';
  root.find('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre').each((_index, element) => {
    const tag = element.tagName.toLocaleLowerCase();
    const text = normalizeText($(element).text());
    if (text === '') return;
    if (/^h[1-6]$/.test(tag)) {
      heading = text.slice(0, 500);
      return;
    }
    for (const chunk of splitSegment(text)) segments.push({ heading, text: chunk });
  });
  if (segments.length === 0) segments.push(...plainSegments(root.text()));
  return { title, author, segments };
}

export function extractCleanSource(options: ExtractSourceOptions): CleanedSourceSnapshot {
  const mediaType = options.contentType.split(';', 1)[0]?.trim().toLocaleLowerCase() ?? '';
  const decoded = options.body.toString('utf8');
  const extracted = mediaType === 'text/html' || mediaType === 'application/xhtml+xml'
    || mediaType === 'application/rss+xml' || mediaType === 'application/atom+xml'
    ? htmlMetadata(decoded)
    : { title: '', author: '', segments: plainSegments(decoded) };
  const limited: Array<{ heading: string; text: string }> = [];
  let used = 0;
  for (const segment of extracted.segments) {
    const remaining = options.maximumCleanTextChars - used;
    if (remaining <= 0) break;
    const text = segment.text.slice(0, remaining).trim();
    if (text === '') continue;
    limited.push({ heading: segment.heading, text });
    used += text.length;
  }
  if (limited.length === 0) throw new Error('Source did not contain extractable text.');
  const segments = limited.map((segment, index) => ({
    segment_id: `p${String(index + 1).padStart(4, '0')}`,
    ...segment,
  }));
  const contentSha256 = createHash('sha256').update(JSON.stringify(segments)).digest('hex');
  return cleanedSourceSnapshotSchema.parse({
    source_id: options.sourceId,
    material_id: options.materialId,
    title: extracted.title || options.fallbackTitle,
    author: extracted.author || options.fallbackAuthor,
    final_url: options.finalUrl,
    content_type: mediaType,
    content_sha256: contentSha256,
    retrieved_at: options.retrievedAt,
    segments,
  });
}
