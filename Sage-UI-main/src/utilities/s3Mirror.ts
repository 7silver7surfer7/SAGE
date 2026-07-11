import { uploadBufferToS3 } from './awsS3-server';

const S3_MIRROR_FOLDER = 'arweave-mirror';
const AWS_REGION = 'us-east-2'; // matches awsS3-server.ts

/**
 * Public GET URL for a display-only S3 mirror of an Arweave txid's bytes.
 * Deterministic (no DB lookup): mirrors are keyed by the txid itself, so any
 * caller that knows a txid can derive this URL directly. Objects are written
 * ACL public-read (see createS3SignedUrl), so no signing is needed to read.
 * Absent for anything never mirrored — most notably NFT metadata, which is
 * intentionally never mirrored (see mirrorToS3 below); a GET against this
 * URL for an unmirrored txid just 404s, which callers treat as "no mirror".
 */
export function s3MirrorUrl(txid: string): string {
  return `https://${process.env.S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${S3_MIRROR_FOLDER}/${txid}`;
}

/**
 * Mirrors bytes to S3 keyed by Arweave txid, as a DISPLAY-ONLY fallback for
 * when a fresh Arweave upload hasn't propagated to a viewer's gateway node
 * yet (this has caused hours-long broken images/video on freshly-approved
 * drops despite the upload being fully mined). Arweave remains the sole
 * permanent record — this mirror is never the source of truth, is never read
 * by the pre-mint retrievability gate, and must NEVER be used for NFT
 * metadata/tokenURI content (metadata permanence is the core NFT promise and
 * must not depend on a company-controlled bucket — callers must only pass
 * media bytes here, never metadata JSON).
 *
 * Self-catching: never throws. A mirror failure must not affect the Arweave
 * upload it's backing up. Callers should still `await` this (not treat it as
 * fire-and-forget) — Cloud Run can freeze an instance right after a response
 * is sent, which would kill an un-awaited upload mid-flight.
 */
export async function mirrorToS3(
  txid: string,
  contentType: string,
  buffer: Buffer
): Promise<void> {
  try {
    await uploadBufferToS3(S3_MIRROR_FOLDER, txid, contentType, buffer);
  } catch (e: any) {
    console.warn(`mirrorToS3(${txid}) failed (non-fatal, Arweave upload already succeeded):`, e?.message || e);
  }
}
