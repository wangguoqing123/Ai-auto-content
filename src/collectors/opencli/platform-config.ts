import type { PlatformQuery } from './query-budget.js';

export interface TwitterQueryConfig extends PlatformQuery {
  language: 'zh' | 'en';
  product: 'top' | 'live';
  exclude_replies: boolean;
  exclude_retweets: boolean;
  minimum_likes: number;
  minimum_views: number;
}

export interface TwitterCollectorConfig {
  max_queries_per_run: number;
  max_results_per_query: number;
  queries: TwitterQueryConfig[];
}

export interface XiaohongshuQueryConfig extends PlatformQuery {}

export interface XiaohongshuCollectorConfig {
  max_queries_per_run: number;
  max_results_per_query: number;
  max_details_per_query: number;
  max_comment_notes_per_run: number;
  max_comments_per_note: number;
  queries: XiaohongshuQueryConfig[];
}

export interface WeixinQueryConfig extends PlatformQuery {}

export interface WeixinCollectorConfig {
  max_queries_per_run: number;
  max_results_per_query: number;
  max_downloads_per_run: number;
  queries: WeixinQueryConfig[];
}

export interface PlatformQueriesConfig {
  version: number;
  twitter: TwitterCollectorConfig;
  xiaohongshu: XiaohongshuCollectorConfig;
  weixin: WeixinCollectorConfig;
}
