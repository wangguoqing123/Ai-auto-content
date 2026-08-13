import { describe, expect, it } from 'vitest';
import {
  canonicalizeWeixinArticleUrl,
  deriveWeixinArticleId,
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
});
