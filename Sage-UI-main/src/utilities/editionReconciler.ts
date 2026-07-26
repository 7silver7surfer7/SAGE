/**
 * Backfills SocialNftEdition rows for editions that exist on-chain but never
 * made it into the database.
 *
 * WHY THIS EXISTS. Launching an edition is two steps that cannot be made
 * atomic: the wallet sends createEdition to SocialNFTLauncher, and then the
 * browser POSTs RecordEditionLaunch so the app has a row to render. The chain
 * half is durable; the database half is a best-effort fetch from a page the
 * user may close, on a network that may drop, against a server whose RPC node
 * may not have the receipt yet. When the second half is lost the NFT is
 * genuinely minted and genuinely invisible — it shows up in no profile, no
 * launcher list, nowhere. Three of the four editions on mainnet were in that
 * state when this was written, including two belonging to the site's own
 * operator, which is how the gap was noticed at all.
 *
 * The chain is the source of truth, so the repair is one-directional: read
 * what the launcher says exists, write the rows that are missing, never delete
 * or overwrite. That makes it safe to run repeatedly and safe to run
 * concurrently with a real launch — a row written by RecordEditionLaunch in
 * between simply makes this a no-op for that edition.
 *
 * THE TRUST BOUNDARY. createEdition is permissionless and costs only gas, so
 * every string this reads off the chain was chosen by whoever sent that
 * transaction — including the metadata URI. A reconciler that fetched those
 * URIs blindly would be a server-side request forgery hole with an on-chain
 * trigger: anyone could make the backend fetch an arbitrary URL by launching
 * an edition pointing at it. So URIs are host-allowlisted BEFORE any fetch,
 * the image URL inside the metadata is allowlisted again after, and anything
 * that fails either check is skipped and reported rather than stored.
 */
import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { parameters } from '@/constants/config';

const EDITION_CREATED =
  'event EditionCreated(address indexed edition, address indexed artist, string name, string symbol, uint256 priceWei, uint256 maxSupply, bool isCollection)';

const LAUNCHER_ABI = [
  EDITION_CREATED,
  'function allEditionsLength() view returns (uint256)',
  'function createEdition(string name_, string symbol_, string uri_, uint256 maxSupply_, uint256 priceWei_) returns (address)',
  'function createCollection(string name_, string symbol_, string baseUri_, uint256 maxSupply_, uint256 priceWei_) returns (address)',
];

/** SocialEditionNFT keeps its metadata URI in a private string. Reading it back
 *  is the one genuinely awkward part of this job, so there are three ways in,
 *  tried strongest-first — see recoverUri. This slot number is the weakest of
 *  the three because it depends on OpenZeppelin's ERC721 field order (name,
 *  symbol, then four mappings; the two immutables occupy no storage), so it is
 *  never trusted on its own — only accepted when it decodes to an allowlisted
 *  URL, which random garbage will not do. */
const URI_SLOT = 6;

/** Hosts the reconciler will fetch metadata from, and accept image URLs on.
 *  Both are first-party: Filebase is where the app pins edition metadata (see
 *  uploadJsonToFilebase), and S3_BUCKET is its own media mirror. Anything else
 *  is a URL an untrusted launcher put on-chain, and is never fetched. */
export function isTrustedArtUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 500) return false;
  if (url.startsWith('https://ipfs.filebase.io/ipfs/')) return true;
  const bucket = process.env.S3_BUCKET;
  // Same rule RecordEditionLaunch applies to client-supplied art.
  return !!bucket && url.startsWith(`https://${bucket}.s3.`) && url.includes('.amazonaws.com/social/');
}

/** Decode a Solidity `string` out of a raw storage slot. Short strings (<32
 *  bytes) live inline with 2*len in the low byte; long ones store 2*len+1 and
 *  put the bytes at keccak256(slot). */
async function readStringSlot(
  provider: ethers.providers.Provider,
  address: string,
  slot: number
): Promise<string | null> {
  try {
    const head = await provider.getStorageAt(address, slot);
    const bytes = ethers.utils.arrayify(head);
    const marker = bytes[31];
    if (marker % 2 === 0) return ethers.utils.toUtf8String(bytes.slice(0, marker / 2));
    const len = ethers.BigNumber.from(head).sub(1).div(2).toNumber();
    if (len > 2000) return null;
    const base = ethers.BigNumber.from(
      ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['uint256'], [slot]))
    );
    let hex = '0x';
    for (let i = 0; i * 32 < len; i++) {
      hex += (await provider.getStorageAt(address, base.add(i).toHexString())).slice(2);
    }
    return ethers.utils.toUtf8String(ethers.utils.arrayify(hex).slice(0, len));
  } catch {
    return null;
  }
}

/** Recover the metadata URI an edition was created with.
 *
 *  1. The creation transaction's calldata. Strongest: it is the exact argument
 *     the artist passed, and it assumes nothing about how the contract chose to
 *     store it. Fails only if the call arrived wrapped (a multicall or a relayer
 *     contract), where the outer calldata is not createEdition.
 *  2. Storage. Works regardless of how the call arrived, but leans on the field
 *     order described at URI_SLOT.
 *  3. tokenURI(1). The public, layout-independent route — and useless here more
 *     often than not, because it reverts until the first token is minted and
 *     the whole point of this job is editions that never got that far.
 */
async function recoverUri(
  provider: ethers.providers.Provider,
  iface: ethers.utils.Interface,
  editionAddress: string,
  txHash: string
): Promise<string | null> {
  try {
    const tx = await provider.getTransaction(txHash);
    if (tx?.data) {
      const parsed = iface.parseTransaction({ data: tx.data, value: tx.value });
      const uri = parsed?.args?.uri_ ?? parsed?.args?.baseUri_;
      if (typeof uri === 'string' && uri) return uri;
    }
  } catch {
    /* wrapped call or unparseable calldata — fall through */
  }

  const fromStorage = await readStringSlot(provider, editionAddress, URI_SLOT);
  if (fromStorage) return fromStorage;

  try {
    const nft = new ethers.Contract(
      editionAddress,
      ['function tokenURI(uint256) view returns (string)'],
      provider
    );
    return await nft.tokenURI(1);
  } catch {
    return null;
  }
}

/** Turn a recovered URI into the image URL the app renders.
 *
 *  Two shapes exist in the wild. The first mainnet edition stored its image URL
 *  directly; everything since stores a metadata JSON whose `image` field points
 *  at the art. Both are handled, and both ends are allowlisted — the URI before
 *  it is fetched, and the `image` inside it before it is stored. */
async function resolveImageUrl(uri: string): Promise<string | null> {
  if (!isTrustedArtUrl(uri)) return null;
  // Already an image (the pre-metadata format): nothing to fetch.
  if (/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(uri)) return uri;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(uri, { signal: controller.signal });
    if (!res.ok) return null;
    const text = (await res.text()).slice(0, 100_000);
    const meta = JSON.parse(text);
    return isTrustedArtUrl(meta?.image) ? meta.image : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type ReconcileReport = {
  scanned: number;
  created: number;
  /** Populated on a dry run: exactly the rows a real run would have written. */
  wouldCreate?: {
    editionAddress: string;
    artistAddress: string;
    name: string;
    symbol: string;
    imageUrl: string;
    priceEth: number;
    maxSupply: number;
    launchTxHash: string;
  }[];
  skipped: { edition: string; reason: string }[];
  errors: string[];
};

/**
 * Scan the launcher and write any missing SocialNftEdition rows.
 *
 * `chainCount === dbCount` is a deliberately cheap first question — one
 * eth_call — so this can be called on an ordinary profile view without adding
 * a log scan to every page load. The comparison can be wrong in the harmless
 * direction (rows left over from a different launcher address make the counts
 * differ forever, costing one extra scan that finds nothing), and cannot be
 * wrong in the harmful one: an edition missing from the database always makes
 * chainCount exceed dbCount.
 */
export async function reconcileEditions(
  opts: { force?: boolean; dryRun?: boolean } = {}
): Promise<ReconcileReport> {
  const report: ReconcileReport = { scanned: 0, created: 0, skipped: [], errors: [] };
  if (opts.dryRun) report.wouldCreate = [];
  const launcher = parameters.SOCIAL_NFT_LAUNCHER_ADDRESS;
  if (!launcher) {
    report.errors.push('no launcher configured for this environment');
    return report;
  }

  const provider = new ethers.providers.StaticJsonRpcProvider(parameters.RPC_URL);
  const contract = new ethers.Contract(launcher, LAUNCHER_ABI, provider);
  const iface = new ethers.utils.Interface(LAUNCHER_ABI);

  let chainCount: number;
  try {
    chainCount = (await contract.allEditionsLength()).toNumber();
  } catch (e: any) {
    report.errors.push(`allEditionsLength failed: ${e.message}`);
    return report;
  }

  const dbCount = await prisma.socialNftEdition.count();
  if (!opts.force && chainCount <= dbCount) return report;

  let logs: ethers.providers.Log[];
  try {
    logs = await provider.getLogs({
      address: launcher,
      topics: [ethers.utils.id('EditionCreated(address,address,string,string,uint256,uint256,bool)')],
      fromBlock: 0,
      toBlock: 'latest',
    });
  } catch (e: any) {
    report.errors.push(`getLogs failed: ${e.message}`);
    return report;
  }
  report.scanned = logs.length;

  const existing = new Set(
    (await prisma.socialNftEdition.findMany({ select: { editionAddress: true } })).map((r) =>
      r.editionAddress.toLowerCase()
    )
  );

  for (const log of logs) {
    let editionAddress = '';
    try {
      const parsed = iface.parseLog(log);
      editionAddress = ethers.utils.getAddress(parsed.args.edition);
      if (existing.has(editionAddress.toLowerCase())) continue;

      const artist = ethers.utils.getAddress(parsed.args.artist);

      // Mirror canParticipate: RecordEditionLaunch would have refused this
      // launch too if the artist had no account or was banned, so writing the
      // row here would be creating something the live path cannot create. A
      // wallet that later signs in gets picked up by the next run.
      const user = await prisma.user.findUnique({
        where: { walletAddress: artist },
        select: { bannedAt: true },
      });
      if (!user) {
        report.skipped.push({ edition: editionAddress, reason: 'artist has no SAGE account' });
        continue;
      }
      if (user.bannedAt) {
        report.skipped.push({ edition: editionAddress, reason: 'artist is banned' });
        continue;
      }

      const uri = await recoverUri(provider, iface, editionAddress, log.transactionHash);
      if (!uri) {
        report.skipped.push({ edition: editionAddress, reason: 'metadata URI unrecoverable' });
        continue;
      }
      const imageUrl = await resolveImageUrl(uri);
      if (!imageUrl) {
        report.skipped.push({ edition: editionAddress, reason: 'art URL not first-party' });
        continue;
      }

      const row = {
        artistAddress: artist,
        editionAddress,
        // Same truncation RecordEditionLaunch applies — these are
        // attacker-choosable strings and the columns are VarChar(60)/(12).
        name: String(parsed.args.name).slice(0, 60),
        symbol: String(parsed.args.symbol).slice(0, 12),
        imageUrl,
        priceEth: Number(ethers.utils.formatEther(parsed.args.priceWei)),
        maxSupply: parsed.args.maxSupply.toNumber(),
        launchTxHash: log.transactionHash,
      };

      if (opts.dryRun) {
        report.wouldCreate!.push(row);
        existing.add(editionAddress.toLowerCase());
        continue;
      }

      await prisma.socialNftEdition.create({ data: row });
      existing.add(editionAddress.toLowerCase());
      report.created++;
    } catch (e: any) {
      // A row created by RecordEditionLaunch between the read above and this
      // write trips the editionAddress unique constraint. That is the two
      // halves agreeing, not a failure.
      if (e?.code === 'P2002') continue;
      report.errors.push(`${editionAddress || log.transactionHash}: ${e.message}`);
    }
  }

  return report;
}

/** Throttle for the read-path call so a busy profile cannot turn into an RPC
 *  hot loop. Per-instance and deliberately not shared — the cost of two Cloud
 *  Run instances each doing one cheap eth_call a minute is nil. */
let lastAutoRun = 0;
const AUTO_INTERVAL_MS = 60_000;

/** Fire-and-forget self-heal, safe to call from a read handler: it awaits
 *  nothing the caller needs and swallows its own failures, so a flaky RPC
 *  degrades the repair rather than the page. */
export async function autoReconcileEditions(): Promise<void> {
  const now = Date.now();
  if (now - lastAutoRun < AUTO_INTERVAL_MS) return;
  lastAutoRun = now;
  try {
    await reconcileEditions();
  } catch {
    /* the profile still renders from whatever rows exist */
  }
}
