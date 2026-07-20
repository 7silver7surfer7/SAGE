import { ethers } from 'ethers';
import { parameters } from '@/constants/config';
import sageWhitelistJson from '@/constants/abis/Utils/SageWhitelist.sol/SageWhitelist.json';
import sageCollectionJson from '@/constants/abis/Collection/SageCollection.sol/SageCollection.json';
import sageNftJson from '@/constants/abis/NFT/SageNFT.sol/SageNFT.json';

/** Canonical burn destination for burn-to-boost. */
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';

/**
 * Freezes a collect-NFT's metadata JSON on Filebase (S3-compatible IPFS) and
 * returns an ipfs:// URI. Env-gated: without FILEBASE_* set, returns null and
 * the caller falls back to the on-site GetPostMetadata URL. Filebase returns
 * the IPFS CID in the `x-amz-meta-cid` response header on PutObject.
 */
export async function uploadJsonToFilebase(
  key: string,
  json: unknown
): Promise<string | null> {
  const bucket = process.env.FILEBASE_BUCKET;
  const accessKey = process.env.FILEBASE_KEY;
  const secretKey = process.env.FILEBASE_SECRET;
  if (!bucket || !accessKey || !secretKey) return null;
  // dynamic import so aws-sdk isn't pulled into bundles that never call this
  const aws = (await import('aws-sdk')).default;
  const s3 = new aws.S3({
    endpoint: 'https://s3.filebase.com',
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    region: 'us-east-1',
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });
  const put = await s3
    .putObject({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(JSON.stringify(json)),
      ContentType: 'application/json',
    })
    .promise();
  // the CID rides on the response metadata
  const cid =
    (put as any)?.['x-amz-meta-cid'] ||
    (await s3.headObject({ Bucket: bucket, Key: key }).promise()).Metadata?.cid;
  return cid ? `ipfs://${cid}` : null;
}

/**
 * Reads an object straight from the Filebase bucket (S3 API, credentialed).
 * Used by the /api/collection-meta resolver: per-object pins each get their
 * OWN CID, so a collection has no shared directory CID and `baseUri + i.json`
 * can't resolve on the public IPFS gateway — this route is how a collection's
 * sequential tokenURIs get served.
 */
export async function getFilebaseObject(
  key: string
): Promise<{ body: Buffer; contentType: string } | null> {
  const fb = await filebaseClient();
  if (!fb) return null;
  try {
    const obj = await fb.s3.getObject({ Bucket: fb.bucket, Key: key }).promise();
    return {
      body: obj.Body as Buffer,
      contentType: obj.ContentType || 'application/octet-stream',
    };
  } catch {
    return null;
  }
}

/** Filebase S3 client, or null when unconfigured. */
async function filebaseClient() {
  const bucket = process.env.FILEBASE_BUCKET;
  const accessKey = process.env.FILEBASE_KEY;
  const secretKey = process.env.FILEBASE_SECRET;
  if (!bucket || !accessKey || !secretKey) return null;
  const aws = (await import('aws-sdk')).default;
  return {
    bucket,
    s3: new aws.S3({
      endpoint: 'https://s3.filebase.com',
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      region: 'us-east-1',
      s3ForcePathStyle: true,
      signatureVersion: 'v4',
    }),
  };
}

/** Pins an arbitrary buffer (e.g. a compressed image) to Filebase; returns ipfs://CID. */
export async function uploadBufferToFilebase(
  key: string,
  contentType: string,
  body: Buffer
): Promise<string | null> {
  const fb = await filebaseClient();
  if (!fb) return null;
  const put = await fb.s3
    .putObject({ Bucket: fb.bucket, Key: key, Body: body, ContentType: contentType })
    .promise();
  const cid =
    (put as any)?.['x-amz-meta-cid'] ||
    (await fb.s3.headObject({ Bucket: fb.bucket, Key: key }).promise()).Metadata?.cid;
  return cid ? `ipfs://${cid}` : null;
}

/**
 * EIP-712 voucher so a collector can mint their post-NFT THEMSELVES (paying
 * their own gas) via SocialCollectMinter. The server signs only after it has
 * settled payment (pixels/SAGE/ETH). Domain must match the contract's
 * EIP712('SAGESocialCollect','1').
 */
export async function signCollectVoucher(
  minterAddress: string,
  chainId: number,
  postId: number,
  collector: string,
  uri: string
): Promise<string> {
  const signer = getServerSigner();
  const domain = {
    name: 'SAGESocialCollect',
    version: '1',
    chainId,
    verifyingContract: minterAddress,
  };
  const types = {
    CollectVoucher: [
      { name: 'postId', type: 'uint256' },
      { name: 'collector', type: 'address' },
      { name: 'uri', type: 'string' },
    ],
  };
  // ethers v5 experimental typed-data signer
  return (signer as any)._signTypedData(domain, types, { postId, collector, uri });
}

/**
 * EIP-712 voucher for SocialFaucet — a wallet's ONE lifetime SAGE claim. The
 * server signs only after it has confirmed (in its own DB) that neither this
 * wallet nor this request's IP hash has claimed before; the contract then
 * independently enforces the once-per-wallet half on-chain. Domain must
 * match the contract's EIP712('SAGESocialFaucet','1').
 */
export async function signFaucetVoucher(
  faucetAddress: string,
  chainId: number,
  claimant: string
): Promise<string> {
  const signer = getServerSigner();
  const domain = {
    name: 'SAGESocialFaucet',
    version: '1',
    chainId,
    verifyingContract: faucetAddress,
  };
  const types = {
    FaucetVoucher: [{ name: 'claimant', type: 'address' }],
  };
  return (signer as any)._signTypedData(domain, types, { claimant });
}

/**
 * SERVER-side platform signer (the operator key — same one the crons and
 * points oracle use). Exists for chain writes that happen without an admin's
 * wallet present, e.g. adding a minter to a drop's on-chain whitelist the
 * moment they claim an IP-gated mint spot. Never import from client code.
 */
function getProvider() {
  // explicit timeout: a bare URL string leaves ethers' fetch with none at
  // all, so one stalled RPC request hangs the API route (and the user's
  // toast) forever instead of failing cleanly
  const provider = new ethers.providers.StaticJsonRpcProvider({
    url: parameters.RPC_URL,
    timeout: 30000,
  });
  // Robinhood Chain rejects EIP-1559 (type-2) fee fields — force legacy
  // gasPrice so server-signed txs (mints, whitelist adds, contractURI) don't
  // fail estimation with a type-2 payload. Same patch the deploy scripts use.
  // ×1.5 headroom: the node treats legacy gasPrice as the fee CAP, and the
  // base fee moves between quote and inclusion — sending at exactly
  // getGasPrice() failed live with "max fee per gas less than block base
  // fee" on a 0.02% base-fee uptick (2026-07-20, pixels collect). Only the
  // real base fee is charged, so the premium costs nothing when fees are flat.
  const getGasPrice = provider.getGasPrice.bind(provider);
  provider.getFeeData = async () => {
    const gasPrice = (await getGasPrice()).mul(150).div(100);
    return { gasPrice, maxFeePerGas: null, maxPriorityFeePerGas: null, lastBaseFeePerGas: null };
  };
  return provider;
}

/**
 * tx.wait() with no deadline can outlive the HTTP request that triggered it
 * (a dropped tx never mines — e.g. a nonce collision with the CI keeper,
 * which signs with this same key). Bound every server-side wait so the
 * caller gets a clean, retryable error instead of an eternal spinner.
 */
async function waitBounded(tx: ethers.ContractTransaction, ms = 60000): Promise<ethers.ContractReceipt> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`tx ${tx.hash} unconfirmed after ${ms / 1000}s`)), ms);
  });
  try {
    return await Promise.race([tx.wait(), deadline]);
  } finally {
    clearTimeout(timer!);
  }
}

export function getServerSigner(): ethers.Wallet {
  const pk = process.env.POINTS_ORACLE_PK;
  if (!pk) throw new Error('POINTS_ORACLE_PK is not configured');
  return new ethers.Wallet(pk, getProvider());
}

/** Deploys a fresh SageWhitelist owned by the platform storage roles. */
export async function deployWhitelistServerSide(): Promise<string> {
  const factory = new ethers.ContractFactory(
    sageWhitelistJson.abi,
    sageWhitelistJson.bytecode,
    getServerSigner()
  );
  const instance = await factory.deploy(parameters.STORAGE_ADDRESS);
  await instance.deployed();
  return instance.address;
}

export async function isWhitelistedOnChain(
  whitelistAddress: string,
  wallet: string
): Promise<boolean> {
  const wl = new ethers.Contract(whitelistAddress, sageWhitelistJson.abi, getProvider());
  return wl.isWhitelisted(wallet, 0);
}

export async function addToWhitelistOnChain(
  whitelistAddress: string,
  wallets: string[]
): Promise<string> {
  const wl = new ethers.Contract(whitelistAddress, sageWhitelistJson.abi, getServerSigner());
  const tx = await wl.addAddresses(wallets);
  await waitBounded(tx);
  return tx.hash;
}

/**
 * Sets a SageNFT's contract-level metadata URL. Requires storage
 * DEFAULT_ADMIN — only the platform key holds it, which is why this runs
 * server-side (dashboard admin wallets would revert).
 */
export async function setContractMetadataOnChain(
  nftContractAddress: string,
  metadataUrl: string
): Promise<string> {
  const abi = ['function setContractMetadata(string _contractMetadata)'];
  const nft = new ethers.Contract(nftContractAddress, abi, getServerSigner());
  const tx = await nft.setContractMetadata(metadataUrl);
  await waitBounded(tx);
  return tx.hash;
}

/**
 * Verifies a mined SAGE ERC-20 transfer before the API credits anything for
 * it (tips, boosts, collect payments). Confirms the tx succeeded and contains
 * a Transfer(from→to) of at least minAmount on the SAGE token. Returns the
 * actual transferred amount in whole SAGE. Throws with a human message on any
 * mismatch — callers surface it as a 400.
 */
export async function verifySageTransfer(
  txHash: string,
  from: string,
  to: string,
  minAmount: number
): Promise<number> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('bad tx hash');
  const receipt = await getProvider().getTransactionReceipt(txHash);
  if (!receipt) throw new Error('transaction not found (not mined yet?)');
  if (receipt.status !== 1) throw new Error('transaction reverted');
  const transferTopic = ethers.utils.id('Transfer(address,address,uint256)');
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== parameters.ASHTOKEN_ADDRESS.toLowerCase()) continue;
    if (log.topics[0] !== transferTopic || log.topics.length < 3) continue;
    const logFrom = ethers.utils.getAddress('0x' + log.topics[1].slice(26)).toLowerCase();
    const logTo = ethers.utils.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
    if (logFrom !== from.toLowerCase() || logTo !== to.toLowerCase()) continue;
    const amount = Number(ethers.utils.formatEther(ethers.BigNumber.from(log.data)));
    if (amount + 1e-9 < minAmount)
      throw new Error(`transfer too small (${amount} < ${minAmount} SAGE)`);
    return amount;
  }
  throw new Error('no matching SAGE transfer in that transaction');
}

/**
 * Native-ETH sibling of verifySageTransfer: confirms a mined plain-value
 * transfer (EOA→EOA) of at least minAmount ETH. Returns the actual amount.
 */
export async function verifyEthTransfer(
  txHash: string,
  from: string,
  to: string,
  minAmount: number
): Promise<number> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('bad tx hash');
  const provider = getProvider();
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
  ]);
  if (!tx || !receipt) throw new Error('transaction not found (not mined yet?)');
  if (receipt.status !== 1) throw new Error('transaction reverted');
  if (tx.from.toLowerCase() !== from.toLowerCase()) throw new Error('wrong sender');
  if (tx.to?.toLowerCase() !== to.toLowerCase()) throw new Error('wrong recipient');
  const amount = Number(ethers.utils.formatEther(tx.value));
  if (amount + 1e-12 < minAmount)
    throw new Error(`transfer too small (${amount} < ${minAmount} ETH)`);
  return amount;
}

/** Currency-dispatching payment check for the social money features. */
export async function verifyPayment(
  txHash: string,
  from: string,
  to: string,
  minAmount: number,
  currency: 'SAGE' | 'ETH'
): Promise<number> {
  return currency === 'ETH'
    ? verifyEthTransfer(txHash, from, to, minAmount)
    : verifySageTransfer(txHash, from, to, minAmount);
}

/**
 * Mints a collected post into the platform's "SAGE Social" SageNFT. Needs the
 * platform signer to hold storage-level role.minter (granted once at contract
 * deploy). Returns the mint tx hash + the new tokenId.
 */
export async function mintSocialCollectServerSide(
  to: string,
  tokenUri: string
): Promise<{ txHash: string; tokenId: number }> {
  const contractAddress = parameters.SOCIAL_COLLECTS_ADDRESS;
  if (!contractAddress) throw new Error('collecting is not enabled on this network yet');
  const nft = new ethers.Contract(contractAddress, sageNftJson.abi, getServerSigner());
  const tx = await nft.safeMint(to, tokenUri);
  const receipt = await waitBounded(tx);
  const ev = receipt.events?.find((e: any) => e.event === 'Transfer');
  if (!ev) throw new Error('mint succeeded but no Transfer event found');
  return { txHash: tx.hash, tokenId: ev.args.tokenId.toNumber() };
}

/** Points a live on-chain collection at a whitelist (AddressZero un-gates). */
export async function setCollectionWhitelistOnChain(
  collectionId: number,
  whitelistAddress: string
): Promise<string> {
  const c = new ethers.Contract(
    parameters.COLLECTION_ADDRESS,
    sageCollectionJson.abi,
    getServerSigner()
  );
  const onChain = await c.getCollection(collectionId);
  if (onChain?.whitelist?.toLowerCase() === whitelistAddress.toLowerCase()) return 'unchanged';
  const tx = await c.setWhitelist(collectionId, whitelistAddress);
  await waitBounded(tx);
  return tx.hash;
}

// ───────────────────────── SagePoints (streaming pixels) ─────────────────────────

const SAGE_POINTS_ABI = [
  'function pointsOf(address) view returns (uint256)',
  'function dailyRateOf(address) view returns (uint256)',
  'function spendFrom(address from, uint256 amount, string reason)',
  'function creditTo(address to, uint256 amount, string reason)',
  'function transferPoints(address from, address to, uint256 amount, string reason)',
];

function pointsContract(signer?: ethers.Signer) {
  const addr = parameters.SAGE_POINTS_ADDRESS;
  if (!addr) throw new Error('SAGE_POINTS_ADDRESS is not configured');
  return new ethers.Contract(addr, SAGE_POINTS_ABI, signer || getProvider());
}

/** Live streamed pixel balance for a wallet (integer pixels). */
export async function pixelsOf(address: string): Promise<bigint> {
  const bal = await pointsContract().pointsOf(address);
  return BigInt(bal.toString());
}

/** Pixels/day the wallet currently earns from its SAGE balance. */
export async function pixelsDailyRate(address: string): Promise<bigint> {
  const rate = await pointsContract().dailyRateOf(address);
  return BigInt(rate.toString());
}

/**
 * Buyer pays seller in pixels — one on-chain tx via the controller wallet.
 * Reverts (throws) with "insufficient pixels" when the buyer can't cover it,
 * so the contract is the single source of truth for spendability.
 */
export async function transferPixelsOnChain(
  from: string,
  to: string,
  amount: bigint,
  reason: string
): Promise<string> {
  const c = pointsContract(getServerSigner());
  const tx = await c.transferPoints(from, to, amount, reason);
  await waitBounded(tx);
  return tx.hash;
}

export async function creditPixelsOnChain(to: string, amount: bigint, reason: string): Promise<string> {
  const c = pointsContract(getServerSigner());
  const tx = await c.creditTo(to, amount, reason);
  await waitBounded(tx);
  return tx.hash;
}
