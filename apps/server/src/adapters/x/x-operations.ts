// Browser-web operations, not the X developer API. Verified against X's public
// main.60bedca26c9a9faaa.js bundle on 2026-09-23. Keep IDs and features in sync.
export const X_OPERATIONS = {
  userByScreenName: {
    id: process.env.X_USER_BY_SCREEN_NAME_OPERATION_ID ?? "KybxDj9RrADIITXlGG8kpw",
    name: "UserByScreenName",
    fieldToggles: { withAuxiliaryUserLabels: true, withPayments: false },
  },
  userReplies: {
    id: process.env.X_USER_REPLIES_OPERATION_ID ?? "xz348nziCm96wndJ1S0MUQ",
    name: "UserRepliesTimeline",
    fieldToggles: { withArticlePlainText: false, withPayments: false },
  },
  userTweets: {
    id: process.env.X_USER_TWEETS_OPERATION_ID ?? "jeAA-59Y9FL7FmjgBNIVPw",
    name: "UserTweets",
    fieldToggles: { withArticlePlainText: false, withPayments: false },
  },
} as const;

export const X_FEATURES = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  premium_content_api_read_enabled: false,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  rweb_sports_post_context_enabled: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  responsive_web_nested_quote_preview_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  longform_notetweets_rich_text_read_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  tweet_with_visibility_results_prefer_gql_media_interstitial_enabled: false,
  tweetypie_unmention_optimization_enabled: true,
  verified_phone_label_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  rweb_video_timestamps_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  hidden_profile_likes_enabled: true,
  hidden_profile_subscriptions_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_enhance_cards_enabled: false,
} as const;

// This is X's public web-client token, not a user credential. It can be
// overridden when X rotates it without changing application code.
export const X_WEB_BEARER_TOKEN =
  process.env.X_WEB_BEARER_TOKEN ??
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export const X_WEB_USER_AGENT =
  process.env.X_WEB_USER_AGENT ??
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
