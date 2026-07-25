import { uploadBufferToFilebase, uploadJsonToFilebase } from './serverWallet';

/**
 * Pull a generated image and pin it permanently, then publish ERC-721
 * metadata pointing at it.
 *
 * Krea's URLs are temporary. Minting one directly would produce an NFT whose
 * art 404s as soon as their storage expires — the single most common way a
 * mint turns out worthless — so the bytes are re-hosted on IPFS before any
 * edition is deployed.
 *
 * SSRF: only the generator's own host is fetchable. The URL reaches here via
 * the model, which reads untrusted text, so an open fetcher would let a
 * prompt injection make this server read its own metadata endpoints.
 */
// gen.krea.ai is where finished images actually land — confirmed against a
// real completed job. Guessing this list would have failed every pin.
export const IMAGE_SOURCE_HOSTS = new Set(['gen.krea.ai', 'api.krea.ai', 's.krea.ai', 'cdn.krea.ai']);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export async function pinImageAndMetadata(
  imageUrl: string,
  name: string,
  description: string
): Promise<{ tokenUri: string; imageUri: string }> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error('that image URL is not valid');
  }
  if (parsed.protocol !== 'https:' || !IMAGE_SOURCE_HOSTS.has(parsed.hostname)) {
    throw new Error('images can only be minted from ones the agent generated');
  }

  const res = await fetch(parsed.toString());
  if (!res.ok) throw new Error('the generated image could not be retrieved — regenerate it');
  const type = res.headers.get('content-type') || 'image/png';
  if (!/^image\//.test(type)) throw new Error('that URL is not an image');

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('the generated image was empty');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('that image is too large to mint');

  const gateway = process.env.FILEBASE_GATEWAY || 'https://ipfs.filebase.io/ipfs';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const stamp = `${Date.now()}-${Math.floor(buf.length)}`;

  const imgCid = await uploadBufferToFilebase(`agent-nft/${stamp}.${ext}`, type, buf);
  if (!imgCid) throw new Error('permanent storage is not configured on this deployment');
  const imageUri = `${gateway}/${imgCid.replace('ipfs://', '')}`;

  const metaCid = await uploadJsonToFilebase(`agent-nft/${stamp}.json`, {
    name,
    description,
    image: imageUri,
  });
  if (!metaCid) throw new Error('permanent storage is not configured on this deployment');

  return { tokenUri: `${gateway}/${String(metaCid).replace('ipfs://', '')}`, imageUri };
}

