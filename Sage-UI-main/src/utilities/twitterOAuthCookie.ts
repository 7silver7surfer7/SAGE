/** Shared between authorize.api.ts and callback.api.ts — the name of the
 *  short-lived cookie carrying this request's random OAuth state + PKCE
 *  challenge across the twitter.com redirect round trip. */
export const TWITTER_OAUTH_COOKIE = 'sage_twitter_oauth';
