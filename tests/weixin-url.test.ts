import { describe, expect, it } from 'vitest';
import {
  canonicalizeWeixinArticleUrl,
  deriveWeixinArticleId,
  deriveWeixinDiscoveryId,
  isWeixinArticleUrl,
} from '../src/collectors/opencli/weixin-url.js';

describe('Weixin article URL safety and identity', () => {
  it.each([
    'https://mp.weixin.qq.com/s?__biz=biz&mid=1&idx=2&sn=stable',
    'https://mp.weixin.qq.com/s/',
    'https://mp.weixin.qq.com/s/stable-slug',
  ])('accepts supported article URL %s', (url) => {
    expect(isWeixinArticleUrl(url)).toBe(true);
  });

  it.each([
    'https://evil.example/s?mid=1',
    'https://mp.weixin.qq.com.evil.example/s?mid=1',
    'http://mp.weixin.qq.com/s?mid=1',
    'https://user:password@mp.weixin.qq.com/s?mid=1',
    'https://mp.weixin.qq.com/not-an-article',
  ])('rejects unsafe article URL %s', (url) => {
    expect(isWeixinArticleUrl(url)).toBe(false);
  });

  it('removes tracking parameters while retaining stable article parameters in fixed order', () => {
    const first = canonicalizeWeixinArticleUrl('https://mp.weixin.qq.com/s?scene=1&sn=stable&mid=10&idx=2&__biz=biz&signature=one');
    const second = canonicalizeWeixinArticleUrl('https://mp.weixin.qq.com/s?pass_ticket=secret&__biz=biz&mid=10&idx=2&sn=stable&signature=two');
    expect(first).toBe('https://mp.weixin.qq.com/s?__biz=biz&mid=10&idx=2&sn=stable');
    expect(second).toBe(first);
  });

  it('derives the same identity from different temporary signatures using exact article metadata', () => {
    const metadata = {
      accountName: '示例公众号', title: '同一篇文章', publishedAt: '2026-08-13T01:00:00.000Z', publishedAtQuality: 'exact' as const,
    };
    const first = deriveWeixinArticleId('https://mp.weixin.qq.com/s?signature=one&scene=1', metadata);
    const second = deriveWeixinArticleId('https://mp.weixin.qq.com/s?signature=two&pass_ticket=secret', metadata);
    expect(first).toBe(second);
    expect(first).toMatch(/^metadata:[a-f0-9]{64}$/);
  });

  it('keeps inferred discovery identity stable across minutes and Shanghai calendar dates', () => {
    const first = deriveWeixinDiscoveryId({
      title: '同一篇文章', summary: '同一段摘要',
      publishedAt: '2026-08-13T15:50:00.000Z', publishedAtQuality: 'inferred',
    });
    const tenMinutesLater = deriveWeixinDiscoveryId({
      title: '同一篇文章', summary: '同一段摘要',
      publishedAt: '2026-08-13T16:00:00.000Z', publishedAtQuality: 'inferred',
    });
    const nextShanghaiDate = deriveWeixinDiscoveryId({
      title: '同一篇文章', summary: '同一段摘要',
      publishedAt: '2026-08-14T16:00:00.000Z', publishedAtQuality: 'inferred',
    });
    expect(tenMinutesLater).toBe(first);
    expect(nextShanghaiDate).toBe(first);
  });

  it('keeps different relative labels stable when their inferred dates differ', () => {
    const twentyThreeHoursAgo = deriveWeixinDiscoveryId({
      title: '同一篇文章', summary: '同一段摘要',
      publishedAt: '2026-08-13T03:00:00.000Z', publishedAtQuality: 'inferred',
    });
    const oneDayAgo = deriveWeixinDiscoveryId({
      title: '同一篇文章', summary: '同一段摘要',
      publishedAt: '2026-08-12T02:00:00.000Z', publishedAtQuality: 'inferred',
    });
    expect(oneDayAgo).toBe(twentyThreeHoursAgo);
  });

  it('uses the same fuzzy identity for inferred and unknown publication times', () => {
    const inferred = deriveWeixinDiscoveryId({
      title: '同一篇文章', summary: '同一段摘要',
      publishedAt: '2026-08-13T03:00:00.000Z', publishedAtQuality: 'inferred',
    });
    const unknown = deriveWeixinDiscoveryId({
      title: '同一篇文章', summary: '同一段摘要',
      publishedAt: null, publishedAtQuality: 'unknown',
    });
    expect(unknown).toBe(inferred);
  });

  it('normalizes exact time to UTC and keeps different exact times distinct', () => {
    const exact = deriveWeixinDiscoveryId({
      title: '同一篇文章', summary: '同一段摘要',
      publishedAt: '2026-08-13T01:00:00.000Z', publishedAtQuality: 'exact',
    });
    const sameInstant = deriveWeixinDiscoveryId({
      title: '同一篇文章', summary: '同一段摘要',
      publishedAt: '2026-08-13T09:00:00+08:00', publishedAtQuality: 'exact',
    });
    const differentInstant = deriveWeixinDiscoveryId({
      title: '同一篇文章', summary: '同一段摘要',
      publishedAt: '2026-08-13T01:00:01.000Z', publishedAtQuality: 'exact',
    });
    expect(sameInstant).toBe(exact);
    expect(differentInstant).not.toBe(exact);
  });

  it('normalizes title and summary while keeping exact identity deterministic', () => {
    const normalized = deriveWeixinDiscoveryId({
      title: 'AI 工具', summary: '一段 摘要',
      publishedAt: '2026-08-13T01:00:00.000Z', publishedAtQuality: 'exact',
    });
    const variant = deriveWeixinDiscoveryId({
      title: '  ＡＩ　工具  ', summary: ' 一段   摘要 ',
      publishedAt: '2026-08-13T01:00:00.000Z', publishedAtQuality: 'exact',
    });
    expect(variant).toBe(normalized);
    expect(deriveWeixinDiscoveryId({
      title: '不同标题', summary: '一段 摘要',
      publishedAt: '2026-08-13T01:00:00.000Z', publishedAtQuality: 'exact',
    })).not.toBe(normalized);
    expect(deriveWeixinDiscoveryId({
      title: 'AI 工具', summary: '明显不同的摘要',
      publishedAt: null, publishedAtQuality: 'unknown',
    })).not.toBe(deriveWeixinDiscoveryId({
      title: 'AI 工具', summary: '一段 摘要',
      publishedAt: null, publishedAtQuality: 'unknown',
    }));
  });
});
