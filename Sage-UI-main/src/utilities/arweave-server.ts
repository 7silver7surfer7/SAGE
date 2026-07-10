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

export async function getArweaveBalance(): Promise<{ address: string; balance: string }> {
  const address = await arweave.wallets.jwkToAddress(arweaveJwk);
  var balance = await arweave.wallets.getBalance(address);
  balance = arweave.ar.winstonToAr(balance);
  console.log(`getArweaveBalance(${address}) :: ${balance}`);
  return { address, balance };
}
