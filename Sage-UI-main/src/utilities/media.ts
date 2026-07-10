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
