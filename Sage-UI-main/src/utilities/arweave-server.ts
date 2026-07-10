import Arweave from 'arweave';
import Transaction from 'arweave/node/lib/transaction';
import { computePrimes } from 'jwk-rsa-compute-primes';

const arweaveJwk = computePrimes(JSON.parse(process.env.ARWEAVE_JSON_JWK || ''));

// Gateway is configurable so a local ArLocal node (free, for testing without
// spending AR) can be used instead of the public arweave.net mainnet gateway.
// e.g. ARWEAVE_HOST=localhost ARWEAVE_PORT=1984 ARWEAVE_PROTOCOL=http
const ARWEAVE_HOST = process.env.ARWEAVE_HOST || 'arweave.net';
const ARWEAVE_PROTOCOL = process.env.ARWEAVE_PROTOCOL || 'https';
const ARWEAVE_PORT = Number(process.env.ARWEAVE_PORT) || (ARWEAVE_PROTOCOL === 'https' ? 443 : 80);

const arweave = Arweave.init({
  host: ARWEAVE_HOST,
  port: ARWEAVE_PORT,
  protocol: ARWEAVE_PROTOCOL,
  timeout: 120000,
});

// Public URL for a stored transaction; matches the configured gateway.
export function arweaveUrl(txId: string): string {
  const isDefaultPort =
    (ARWEAVE_PROTOCOL === 'https' && ARWEAVE_PORT === 443) ||
    (ARWEAVE_PROTOCOL === 'http' && ARWEAVE_PORT === 80);
  const host = isDefaultPort ? ARWEAVE_HOST : `${ARWEAVE_HOST}:${ARWEAVE_PORT}`;
  return `${ARWEAVE_PROTOCOL}://${host}/${txId}`;
}

export async function sendArweaveTransaction(
  filename: string,
  data: Uint8Array,
  contentType: string
): Promise<{ tx: Transaction; balance: string }> {
  const tx = await arweave.createTransaction({ data }, arweaveJwk);
  tx.addTag('Content-Type', contentType);
  await arweave.transactions.sign(tx, arweaveJwk);
  // Chunked uploader, NOT transactions.post(): post()'s response was never
  // checked, and a silently failed data upload leaves an accepted tx header
  // with no data behind it — a permanently 0-byte URL that the UI treats as
  // a successful upload. The uploader posts chunk-by-chunk with retries and
  // throws on failure, so a broken upload fails the request loudly instead.
  const uploader = await arweave.transactions.getUploader(tx);
  while (!uploader.isComplete) {
    await uploader.uploadChunk();
  }
  if (uploader.lastResponseError) {
    throw new Error(
      `Arweave upload of '${filename}' failed: ${uploader.lastResponseError} ` +
        `(http ${uploader.lastResponseStatus})`
    );
  }
  console.log(
    `sendArweaveTransaction() :: ${filename} -> ${tx.id} ` +
      `(${uploader.uploadedChunks}/${uploader.totalChunks} chunks)`
  );
  const { balance } = await getArweaveBalance();
  return { tx, balance };
}

/**
 * Signs an Arweave transaction HEADER for a browser-side chunked upload.
 *
 * Cloud Run rejects request bodies over 32MB at Google's edge (hard HTTP/1
 * limit — the request never reaches this app), so large media can't flow
 * through our own upload endpoint. Instead the browser computes the data's
 * merkle root locally and uploads the bytes straight to arweave.net; an
 * Arweave signature only covers the header fields (data_root + data_size +
 * tags — not the raw bytes), so this server can authorize and pay for the
 * upload without ever seeing the file, and the wallet key never leaves here.
 *
 * The caller-supplied data_root is unforgeable-by-construction: chunks whose
 * merkle root doesn't match simply can't be attached to the transaction.
 */
export async function signChunkedUploadTx(
  dataSize: number,
  dataRoot: string,
  contentType: string
): Promise<{ tx: object; balance: string }> {
  // createTransaction() insists on full data bytes, so build the header-only
  // transaction manually: anchor + network price + caller's data_root.
  const [anchor, price] = await Promise.all([
    arweave.api.get('tx_anchor').then((r) => String(r.data)),
    arweave.api.get(`price/${dataSize}`).then((r) => String(r.data)),
  ]);
  const tx = new Transaction({
    format: 2,
    last_tx: anchor,
    owner: arweaveJwk.n,
    reward: price,
    data_size: String(dataSize),
    data_root: dataRoot,
  } as any);
  // pre-set chunks so sign()'s prepareChunks(empty data) doesn't blank the
  // data_root we were given; the raw-bytes form is only used client-side
  (tx as any).chunks = { chunks: [], proofs: [], data_root: new Uint8Array() };
  tx.addTag('Content-Type', contentType);
  await arweave.transactions.sign(tx, arweaveJwk);
  console.log(
    `signChunkedUploadTx() :: signed ${tx.id} (${dataSize} bytes, ${contentType})`
  );
  const { balance } = await getArweaveBalance();
  return { tx: tx.toJSON(), balance };
}

export async function getArweaveBalance(): Promise<{ address: string; balance: string }> {
  const address = await arweave.wallets.jwkToAddress(arweaveJwk);
  var balance = await arweave.wallets.getBalance(address);
  balance = arweave.ar.winstonToAr(balance);
  console.log(`getArweaveBalance(${address}) :: ${balance}`);
  return { address, balance };
}
