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
 * Rewrites an arweave.net media URL to this app's own /api/media proxy for
 * VIDEO playback. The Arweave gateway answers ranged requests with 200 + full
 * body instead of 206, and Safari refuses to play <video> without real range
 * support ("media unsupported") — the proxy serves proper 206 responses from
 * a local cache. Images don't need ranges and keep loading from the gateway
 * directly. Non-Arweave URLs (legacy S3 .mp4 paths) pass through untouched.
 */
export function videoPlaybackSrc(src: string): string {
  const m = /^https?:\/\/arweave\.net\/([A-Za-z0-9_-]{43})(?:[?#]|$)/.exec(src || '');
  // trailing slash avoids the app's trailingSlash 308 redirect on every segment request
  return m ? `/api/media/${m[1]}/` : src;
}

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
