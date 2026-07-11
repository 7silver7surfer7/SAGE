/**
 * Detects whether a stored media URL is a video. Legacy S3 paths keep a real
 * `.mp4` extension; Arweave URLs are bare content hashes, so uploads tag video
 * files with a `?filetype=mp4` marker instead (see arweaveUpload.page.ts).
 */
export function isVideoSrc(src: string | null | undefined): boolean {
  if (!src) return false;
  const s = src.toLowerCase();
  return s.endsWith('mp4') || s.includes('filetype=mp4');
}

/**
 * Rewrites an arweave.net media URL to this app's own /api/media proxy.
 * arweave.net load-balances across many edge nodes; a freshly-mined tx is
 * committed (permanent, unlosable) well before every node has it, so a node
 * that hasn't caught up yet 404s a perfectly good upload — direct <img>/video
 * tags hitting arweave.net have no defense against that. The proxy retries
 * across attempts with backoff and caches the result, so once ANY node has
 * served it, every future viewer gets the cached copy instantly. Originally
 * built for video (Safari needs real 206 range support, which the gateway
 * doesn't provide) but applies equally to images — a drop banner or artist
 * icon can 404 for hours on a stale edge node exactly like a video can.
 * Non-Arweave URLs (legacy S3 paths) pass through untouched.
 */
export function arweaveProxySrc(src: string | null | undefined): string {
  const m = /^https?:\/\/arweave\.net\/([A-Za-z0-9_-]{43})(?:[?#]|$)/.exec(src || '');
  // trailing slash avoids the app's trailingSlash 308 redirect on every segment request
  return m ? `/api/media/${m[1]}/` : src || '';
}

/** @deprecated use arweaveProxySrc — kept as an alias, same rewrite applies to images too now */
export const videoPlaybackSrc = arweaveProxySrc;

/**
 * Poster (first-frame JPEG) URL for a video, served by the /api/media proxy.
 * A few-KB still that paints instantly, so a tile frames the artwork before the
 * <video> has loaded any bytes. Returns '' for non-Arweave videos (legacy S3
 * paths have no poster endpoint), letting callers fall back to no poster.
 */
export function videoPosterSrc(src: string): string {
  const m = /^https?:\/\/arweave\.net\/([A-Za-z0-9_-]{43})(?:[?#]|$)/.exec(src || '');
  return m ? `/api/media/${m[1]}/?poster=1` : '';
}
