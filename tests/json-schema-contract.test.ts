import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { createBrowserMaterial, type BrowserMaterialInput } from '../src/collectors/opencli/material-factory.js';
import { materialSchema } from '../src/types.js';

const schemasDirectory = path.join(process.cwd(), 'schemas');
const fixturesDirectory = path.join(process.cwd(), 'tests', 'fixtures');
const unifiedSchema = JSON.parse(readFileSync(path.join(schemasDirectory, 'unified-material.schema.json'), 'utf8'));
const materialCardSchema = JSON.parse(readFileSync(path.join(schemasDirectory, 'material-card.schema.json'), 'utf8'));
const cloudFixture = JSON.parse(readFileSync(path.join(fixturesDirectory, 'cloud-material.json'), 'utf8')) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: true, formats: { 'date-time': true } });
const validateUnified = ajv.compile(unifiedSchema);
const validateMaterialCard = ajv.compile(materialCardSchema);

function expectValid(validate: ValidateFunction, value: unknown): void {
  expect(validate(value)).toBe(true);
  expect(validate.errors).toBeNull();
}

function expectInvalid(validate: ValidateFunction, value: unknown): void {
  expect(validate(value)).toBe(false);
  expect(validate.errors).not.toBeNull();
}

function browserMaterial(overrides: Partial<BrowserMaterialInput> = {}) {
  return createBrowserMaterial({
    sourcePlatform: 'twitter',
    collector: 'opencli-twitter-rich',
    queryId: 'ai-news-top',
    queryText: 'AI news',
    searchRank: 1,
    sourceItemId: 'tweet-1',
    authorName: 'Example Author',
    title: 'Example browser material',
    excerpt: 'Example excerpt',
    sourceUrl: 'https://x.com/example/status/tweet-1',
    canonicalUrl: 'https://x.com/example/status/tweet-1',
    publishedAt: '2026-08-13T00:00:00.000Z',
    publishedAtQuality: 'exact',
    collectedAt: '2026-08-13T01:00:00.000Z',
    engagement: { views: 100, likes: 5 },
    usageMode: 'trend_signal',
    viralConfidence: 'candidate',
    ...overrides,
  });
}

describe('JSON Schema contracts', () => {
  it('accepts the complete Cloud Material fixture', () => {
    expectValid(validateMaterialCard, cloudFixture);
  });

  it.each([
    ['X', browserMaterial()],
    ['deprecated historical Xiaohongshu', browserMaterial({
      sourcePlatform: 'xiaohongshu', collector: 'opencli-xiaohongshu', sourceItemId: 'note-1',
      sourceUrl: 'https://www.xiaohongshu.com/explore/note-1', canonicalUrl: 'https://www.xiaohongshu.com/explore/note-1',
    })],
    ['resolved Weixin', browserMaterial({
      sourcePlatform: 'weixin', collector: 'opencli-weixin', sourceItemId: 'discovery:stable',
      identityAliases: ['sn:biz:stable'], sourceAccessStatus: 'resolved',
      sourceUrl: 'https://mp.weixin.qq.com/s?__biz=biz&sn=stable',
      canonicalUrl: 'https://mp.weixin.qq.com/s?__biz=biz&sn=stable',
      contentDownloaded: true, usageMode: 'fact_source', viralConfidence: 'unverified',
    })],
    ['unresolved Weixin', browserMaterial({
      sourcePlatform: 'weixin', collector: 'opencli-weixin', sourceItemId: 'discovery:unresolved',
      sourceAccessStatus: 'unresolved', sourceUrl: 'https://weixin.sogou.com/link',
      canonicalUrl: 'https://weixin.sogou.com/link', contentDownloaded: false,
      usageMode: 'structure_inspiration', viralConfidence: 'unverified', status: 'quarantined',
      rejectionReasons: ['unresolved_source_url'],
    })],
  ])('accepts a serialized %s Browser Material', (_label, material) => {
    expectValid(validateUnified, material);
  });

  it('rejects serialized output missing identity_aliases', () => {
    const { identity_aliases: _identityAliases, ...missingIdentityAliases } = browserMaterial();
    expectInvalid(validateUnified, missingIdentityAliases);
  });

  it('rejects an invalid source_access_status', () => {
    expectInvalid(validateUnified, { ...browserMaterial(), source_access_status: 'unknown' });
  });

  it('rejects an empty identity alias', () => {
    expectInvalid(validateUnified, { ...browserMaterial(), identity_aliases: [''] });
  });

  it('rejects a non-boolean content_downloaded value', () => {
    expectInvalid(validateUnified, { ...browserMaterial(), content_downloaded: 'false' });
  });

  it('rejects undeclared fields', () => {
    expectInvalid(validateUnified, { ...browserMaterial(), unexpected_field: true });
  });

  it('upgrades a legacy Cloud JSON row through Zod defaults before JSON Schema validation', () => {
    const legacy = { ...cloudFixture };
    delete legacy.identity_aliases;
    delete legacy.source_access_status;
    delete legacy.content_downloaded;
    const upgraded = materialSchema.parse(legacy);
    expect(upgraded).toMatchObject({
      identity_aliases: [], source_access_status: 'resolved', content_downloaded: false,
    });
    expectValid(validateMaterialCard, upgraded);
  });

  it('accepts current Cloud output with additionalProperties disabled', () => {
    expectValid(validateMaterialCard, materialSchema.parse(cloudFixture));
  });
});
