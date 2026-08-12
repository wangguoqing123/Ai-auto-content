import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const FALLBACK_OPERATION = {
  queryId: 'Yw6L66Pw54NHKuq4Dp7b4Q',
  features: {
    rweb_video_screen_enabled: true,
    rweb_cashtags_enabled: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    rweb_cashtags_composer_attachment_enabled: true,
    responsive_web_jetfuel_frame: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_grok_annotations_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    responsive_web_grok_show_grok_translated_post: false,
    responsive_web_grok_analysis_button_from_backend: true,
    post_ctas_fetch_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: false,
    responsive_web_enhance_cards_enabled: false,
  },
  fieldToggles: {
    withPayments: true,
    withAuxiliaryUserLabels: true,
    withArticleRichContentState: true,
    withArticlePlainText: true,
    withArticleSummaryText: true,
    withArticleVoiceOver: true,
    withGrokAnalyze: true,
    withDisallowedReplyControls: true,
  },
};

async function resolvePublicWebBearer(page) {
  return page.evaluate(`async () => {
    const scripts = Array.from(new Set(Array.from(document.scripts).map((script) => script.src).filter((src) => src && src.includes('client-web'))));
    for (const url of scripts.slice(-20)) {
      try {
        const source = await (await fetch(url)).text();
        const match = source.match(/["'](AAAAA[A-Za-z0-9%_-]{70,180})["']/);
        if (match) return match[1];
      } catch {}
    }
    return null;
  }`);
}

async function resolveOperation(page) {
  const resolved = await page.evaluate(`async () => {
    try {
      const response = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json');
      if (!response.ok) return null;
      const entry = (await response.json()).SearchTimeline;
      if (!entry || !entry.queryId) return null;
      const flags = (value) => Array.isArray(value)
        ? Object.fromEntries(value.map((key) => [key, true]))
        : (value && typeof value === 'object' ? value : {});
      return { queryId: entry.queryId, features: flags(entry.features || entry.featureSwitches), fieldToggles: flags(entry.fieldToggles) };
    } catch { return null; }
  }`);
  return resolved && resolved.queryId ? resolved : FALLBACK_OPERATION;
}

function unwrapTweet(value) {
  if (!value) return null;
  return value.tweet || value;
}

function mediaFromLegacy(legacy) {
  const media = legacy?.extended_entities?.media || legacy?.entities?.media || [];
  const urls = [];
  const posters = [];
  for (const item of media) {
    if (!item) continue;
    const mp4 = item.video_info?.variants?.find((variant) => variant?.content_type === 'video/mp4')?.url;
    const url = mp4 || item.media_url_https;
    if (url) {
      urls.push(url);
      posters.push(item.media_url_https || url);
    }
  }
  return { has_media: urls.length > 0, media_urls: urls, media_posters: posters };
}

function parseTimeline(payload, seen) {
  const rows = [];
  let cursor = null;
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.tweet_results?.result) {
      const tweet = unwrapTweet(value.tweet_results.result);
      if (tweet?.rest_id && !seen.has(tweet.rest_id)) {
        seen.add(tweet.rest_id);
        const legacy = tweet.legacy || {};
        const user = tweet.core?.user_results?.result;
        rows.push({
          id: tweet.rest_id,
          author: user?.core?.screen_name || user?.legacy?.screen_name || '',
          author_followers: user?.legacy && Object.hasOwn(user.legacy, 'followers_count') ? user.legacy.followers_count : null,
          text: tweet.note_tweet?.note_tweet_results?.result?.text || legacy.full_text || '',
          created_at: legacy.created_at || '',
          likes: Object.hasOwn(legacy, 'favorite_count') ? legacy.favorite_count : null,
          retweets: Object.hasOwn(legacy, 'retweet_count') ? legacy.retweet_count : null,
          replies: Object.hasOwn(legacy, 'reply_count') ? legacy.reply_count : null,
          quotes: Object.hasOwn(legacy, 'quote_count') ? legacy.quote_count : null,
          bookmarks: Object.hasOwn(legacy, 'bookmark_count') ? legacy.bookmark_count : null,
          views: tweet.views && Object.hasOwn(tweet.views, 'count') ? tweet.views.count : null,
          url: `https://x.com/i/status/${tweet.rest_id}`,
          ...mediaFromLegacy(legacy),
        });
      }
    }
    if ((value.cursorType === 'Bottom' || value.cursorType === 'ShowMore') && value.value) cursor = value.value;
    if (Array.isArray(value)) for (const child of value) visit(child);
    else for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  };
  visit(payload?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || []);
  return { rows, cursor };
}

cli({
  site: 'twitter',
  name: 'search-rich',
  access: 'read',
  description: 'Read-only Twitter/X search with rich engagement and author follower fields',
  domain: 'x.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', type: 'string', required: true, positional: true },
    { name: 'product', type: 'string', default: 'top', choices: ['top', 'live'] },
    { name: 'limit', type: 'int', default: 15 },
  ],
  columns: ['id', 'author', 'author_followers', 'text', 'created_at', 'likes', 'retweets', 'replies', 'quotes', 'bookmarks', 'views', 'url', 'has_media', 'media_urls', 'media_posters'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query || '').trim();
    const limit = Number(kwargs.limit || 15);
    if (!query) throw new ArgumentError('twitter search-rich query is empty');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ArgumentError('twitter search-rich --limit must be 1-100');
    const cookies = await page.getCookies({ url: 'https://x.com' });
    const ct0 = cookies.find((cookie) => cookie.name === 'ct0')?.value;
    if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
    await page.goto('https://x.com/home', { waitUntil: 'load', settleMs: 1000 });
    const operation = await resolveOperation(page);
    const bearerToken = await resolvePublicWebBearer(page);
    if (!bearerToken) throw new CommandExecutionError('Could not discover X public web bearer token from the current client bundle');
    const headers = {
      Authorization: `Bearer ${decodeURIComponent(bearerToken)}`,
      'X-Csrf-Token': ct0,
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
      'Content-Type': 'application/json',
    };
    const rows = [];
    const seen = new Set();
    let cursor = null;
    for (let pageNo = 0; pageNo < 10 && rows.length < limit; pageNo += 1) {
      const variables = { rawQuery: query, count: Math.min(100, limit - rows.length + 10), querySource: 'typed_query', product: kwargs.product === 'live' ? 'Latest' : 'Top' };
      if (cursor) variables.cursor = cursor;
      const body = JSON.stringify({ variables, features: operation.features, fieldToggles: operation.fieldToggles });
      const endpoint = `/i/api/graphql/${operation.queryId}/SearchTimeline`;
      const response = await page.evaluate(`async () => {
        const response = await fetch(${JSON.stringify(endpoint)}, {
          method: 'POST', credentials: 'include', headers: ${JSON.stringify(headers)}, body: ${JSON.stringify(body)}
        });
        return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) };
      }`);
      if (!response?.ok) throw new CommandExecutionError(`Twitter SearchTimeline failed with HTTP ${response?.status || 'unknown'}`);
      const parsed = parseTimeline(response.data, seen);
      rows.push(...parsed.rows);
      if (!parsed.cursor || parsed.cursor === cursor) break;
      cursor = parsed.cursor;
    }
    return rows.slice(0, limit);
  },
});
