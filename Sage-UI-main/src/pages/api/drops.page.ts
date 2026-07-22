import { NextApiRequest, NextApiResponse } from 'next';
import { Nft, Prisma, Role } from '@prisma/client';
import { readPresetDropsFromS3, uploadBufferToS3 } from '@/utilities/awsS3-server';
import { deleteFromS3Mirror } from '@/utilities/s3Mirror';
import { isVideoSrc } from '@/utilities/media';
import { flushDropAllowlist, flushAllPendingAllowlists } from '@/utilities/allowlistFlush';
import { PresetDrop } from '@/store/dropsReducer';
import { withArtistDisplayNameOverride } from '@/prisma/functions';
import { requireRole } from '@/utilities/apiAuth';
import { parseAddressList, ALLOWLIST_MAX_ADDRESSES } from '@/utilities/allowlist';
import {
  deployWhitelistServerSide,
  addToWhitelistOnChain,
  isWhitelistedOnChain,
  setCollectionWhitelistOnChain,
  setContractMetadataOnChain,
  signOpenEditionVoucher,
  signLotteryVoucher,
} from '@/utilities/serverWallet';
import { sendArweaveTransaction } from '@/utilities/arweave-server';
import { createHash } from 'crypto';
import prisma from '@/prisma/client';
import sharp from 'sharp';
import { OPTIMIZED_IMAGE_WIDTH, parameters } from '@/constants/config';

// Per-action role gating. Previously every action (including DeleteDrops,
// which wipes the whole catalog) was reachable by ANY signed-in wallet — the
// handler only checked for a session. Reads used by the dashboard/deploy flow
// stay broad; drop mutation/approval/deletion is ADMIN-only.
const ACTION_ROLES: Record<string, Role[]> = {
  GetApprovedDrops: [Role.USER, Role.ARTIST, Role.ADMIN],
  GetFullDrop: [Role.USER, Role.ARTIST, Role.ADMIN],
  GetNftContractAddress: [Role.USER, Role.ARTIST, Role.ADMIN],
  GetDropsPendingApproval: [Role.ADMIN],
  GetPresetDrops: [Role.ADMIN],
  FindSplitterAddress: [Role.ADMIN],
  // ── Self-serve social launches: the deploy-time actions below are open to
  // any signed-in wallet, but NON-ADMINS are hard-scoped (see requireDropOwner
  // in the handler) to drops whose artistAddress is their own wallet — the
  // admin dashboard's reach is unchanged, a creator can only touch their own.
  OptimizeDropImages: [Role.USER, Role.ARTIST, Role.ADMIN],
  UpdateNftContractAddress: [Role.USER, Role.ARTIST, Role.ADMIN],
  UpdateSplitterAddress: [Role.ADMIN],
  UpdateAuctionContractAddress: [Role.USER, Role.ARTIST, Role.ADMIN],
  UpdateLotteryContractAddress: [Role.ADMIN],
  UpdateOpenEditionContractAddress: [Role.USER, Role.ARTIST, Role.ADMIN],
  UpdateCollectionContractAddress: [Role.USER, Role.ARTIST, Role.ADMIN],
  UpdateCollectionNftContract: [Role.USER, Role.ARTIST, Role.ADMIN],
  UpdateApprovedDateAndIsLiveFlags: [Role.USER, Role.ARTIST, Role.ADMIN],
  DeleteDrop: [Role.ADMIN],
  DeleteDrops: [Role.ADMIN],
  // Per-drop allowlist gating. Admin manages the list; CheckDropAllowlist is
  // broad because every signed-in visitor needs to learn "am I allowed to buy"
  // (the wallet is taken from the JWT, never from the query — not spoofable).
  // Get/Mark are drop-owner-scoped for the followers-only gate deploy sync.
  GetDropAllowlist: [Role.USER, Role.ARTIST, Role.ADMIN],
  SaveDropAllowlist: [Role.ADMIN],
  MarkAllowlistSynced: [Role.USER, Role.ARTIST, Role.ADMIN],
  CheckDropAllowlist: [Role.USER, Role.ARTIST, Role.ADMIN],
  // IP-gated minting: ClaimMintSpot is how a signed-in minter gets onto the
  // drop's on-chain whitelist — the server enforces one claim per network
  // (salted IP hash) and one per wallet, then adds the wallet on-chain with
  // the platform key. EnableIpGate flips the gate on for a LIVE drop
  // (deploys/wires the whitelist server-side).
  ClaimMintSpot: [Role.USER, Role.ARTIST, Role.ADMIN],
  EnableIpGate: [Role.ADMIN],
  // Voucher-gated minting: an eligible wallet asks the server to SIGN a
  // per-wallet voucher (no on-chain whitelist write, zero server gas), then
  // redeems it itself via batchMintWithVoucher / buyTicketsWithVoucher.
  GetGameVoucher: [Role.USER, Role.ARTIST, Role.ADMIN],
};

async function handler(request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { action, id, address },
  } = request;
  // Unauthenticated cron poke (the SyncPixelBank pattern — CI holds no
  // credentials): flush every gated drop's pending follow-gate entries in one
  // batched tx per drop. Must run BEFORE the role gate: everything below
  // requires a session, and this is invoked by a bare curl on a schedule.
  // Safe unauthenticated — it can only push the DB's own allowlist ledger
  // on-chain (idempotent), never modify it.
  if (action === 'SyncAllowlists') {
    const r = await flushAllPendingAllowlists();
    response.json(r);
    return;
  }
  const allowedRoles = ACTION_ROLES[String(action)];
  if (!allowedRoles) {
    response.status(400).end('Bad Request');
    return;
  }
  const requester = await requireRole(request, response, allowedRoles);
  if (!requester) {
    return;
  }
  const walletAddress = requester.walletAddress;

  // ── Ownership scope for the self-serve deploy actions ──
  // Non-admins may only operate on drops they created. Each action's `id`
  // means something different (drop / auction / OE / collection-mint), so
  // resolve it to the owning drop's artistAddress before dispatching.
  if (requester.role !== Role.ADMIN) {
    const idNum = Number(id);
    let dropArtist: string | null | undefined;
    switch (action) {
      case 'OptimizeDropImages':
      case 'UpdateApprovedDateAndIsLiveFlags':
      case 'GetDropAllowlist':
        dropArtist = (
          await prisma.drop.findUnique({ where: { id: idNum }, select: { artistAddress: true } })
        )?.artistAddress;
        break;
      case 'MarkAllowlistSynced':
        dropArtist = (
          await prisma.drop.findUnique({
            where: { id: Number(request.body?.dropId) || 0 },
            select: { artistAddress: true },
          })
        )?.artistAddress;
        break;
      case 'UpdateAuctionContractAddress':
        dropArtist = (
          await prisma.auction.findUnique({
            where: { id: idNum },
            select: { Drop: { select: { artistAddress: true } } },
          })
        )?.Drop?.artistAddress;
        break;
      case 'UpdateOpenEditionContractAddress':
        dropArtist = (
          await prisma.openEdition.findUnique({
            where: { id: idNum },
            select: { Drop: { select: { artistAddress: true } } },
          })
        )?.Drop?.artistAddress;
        break;
      case 'UpdateCollectionContractAddress':
      case 'UpdateCollectionNftContract':
        dropArtist = (
          await prisma.collectionMint.findUnique({
            where: { id: idNum },
            select: { Drop: { select: { artistAddress: true } } },
          })
        )?.Drop?.artistAddress;
        break;
      case 'UpdateNftContractAddress':
        // a creator may only (re)bind THEIR OWN artist contract record
        dropArtist = String(request.query.artistAddress || '');
        break;
      default:
        dropArtist = undefined; // action not ownership-scoped
    }
    if (
      dropArtist !== undefined &&
      (dropArtist || '').toLowerCase() !== walletAddress.toLowerCase()
    ) {
      response.status(403).json({ error: 'not your drop' });
      return;
    }
  }

  switch (action) {
    case 'GetApprovedDrops':
      await getApprovedDrops(response);
      break;
    case 'GetDropsPendingApproval':
      await getDropsPendingApproval(response);
      break;
    case 'GetFullDrop':
      await getFullDrop(Number(id), response);
      break;
    case 'GetNftContractAddress':
      await getNftContractAddress(address as string, response);
      break;
    case 'GetPresetDrops':
      await getPresetDrops(response);
      break;
    case 'UpdateNftContractAddress':
      await updateNftContractAddress(
        request.query.artistAddress as string,
        request.query.contractAddress as string,
        response
      );
      break;
    case 'FindSplitterAddress':
      await findSplitterAddress(Number(id), response);
      break;
    case 'OptimizeDropImages':
      await optimizeDropImages(Number(id), response);
      break;
    case 'UpdateSplitterAddress':
      await updateSplitterAddress(Number(id), address as string, response);
      break;
    case 'UpdateAuctionContractAddress':
      await updateAuctionContractAddress(Number(id), address as string, response);
      break;
    case 'UpdateLotteryContractAddress':
      await updateLotteryContractAddress(Number(id), address as string, response);
      break;
    case 'UpdateOpenEditionContractAddress':
      await updateOpenEditionContractAddress(Number(id), address as string, response);
      break;
    case 'UpdateCollectionContractAddress':
      await updateCollectionContractAddress(Number(id), address as string, response);
      break;
    case 'UpdateCollectionNftContract':
      await updateCollectionNftContract(Number(id), address as string, response);
      break;
    case 'UpdateApprovedDateAndIsLiveFlags':
      await updateApprovedDateAndIsLiveFlags(Number(id), walletAddress as string, response);
      break;
    case 'DeleteDrop':
      await deleteDrop(Number(id), response);
      break;
    case 'DeleteDrops':
      await deleteDrops(response);
      break;
    case 'GetDropAllowlist':
      await getDropAllowlist(Number(id), response);
      break;
    case 'SaveDropAllowlist':
      await saveDropAllowlist(request, response);
      break;
    case 'MarkAllowlistSynced':
      await markAllowlistSynced(request, response);
      break;
    case 'CheckDropAllowlist':
      await checkDropAllowlist(Number(id), walletAddress, response);
      break;
    case 'ClaimMintSpot':
      await claimMintSpot(Number(id), walletAddress, request, response);
      break;
    case 'EnableIpGate':
      await enableIpGate(Number(id), response);
      break;
    case 'GetGameVoucher':
      await getGameVoucher(request, walletAddress, response);
      break;
    default:
      response.status(500);
  }
  response.end();
}

async function getApprovedDrops(response: NextApiResponse) {
  console.log(`getApprovedDrops()`);
  try {
    const result = await prisma.drop.findMany({
      where: { approvedAt: { not: null } },
      include: {
        NftContract: { include: { Artist: true } },
        Lotteries: { include: { Nfts: true } },
        Auctions: { include: { Nft: true } },
        OpenEditions: { include: { Nft: true } },
        // collection-style drops (e.g. rMonet) weren't surfaced here at all —
        // any consumer of this endpoint (dashboard, sage-mcp agents) had no
        // way to discover or mint them
        CollectionMints: true,
      },
      orderBy: {
        id: 'desc',
      },
      // admin listing: bound the payload — every drop with every nested NFT
      // otherwise ships on each dashboard load, growing with the catalog
      take: 100,
    });
    result.forEach(withArtistDisplayNameOverride);
    response.json(result);
  } catch (e) {
    console.log({ e });
    response.status(500);
  }
}

async function getDropsPendingApproval(response: NextApiResponse) {
  console.log(`getDropsPendingApproval()`);
  try {
    const result = await prisma.drop.findMany({
      where: { approvedAt: null },
      include: {
        NftContract: { include: { Artist: true } },
        Lotteries: { include: { Nfts: true } },
        Auctions: { include: { Nft: true } },
        OpenEditions: { include: { Nft: true } },
        CollectionMints: true,
      },
      orderBy: { id: 'desc' },
      take: 100,
    });
    result.forEach(withArtistDisplayNameOverride);
    response.json(result);
  } catch (e) {
    console.log({ e });
    response.status(500);
  }
}

// lazy allowlist-flush throttle: a viewed gated drop drains its pending
// queue at most once per 30s per instance (mirrors the pool-sync pattern)
const allowlistFlushAt = new Map<number, number>();

async function getFullDrop(id: number, response: NextApiResponse) {
  console.log(`getFullDrop(${id})`);
  try {
    const result = await prisma.drop.findUnique({
      where: { id },
      include: {
        NftContract: { include: { Artist: true } },
        Auctions: { include: { Nft: true } },
        OpenEditions: { include: { Nft: true } },
        Lotteries: { include: { Nfts: true } },
        CollectionMints: true,
      },
    });
    if (result) withArtistDisplayNameOverride(result);
    // follow-gate enqueues without transacting; viewing the drop flushes the
    // batch so anyone about to mint is on-chain before they reach the button.
    // AWAITED deliberately — Cloud Run throttles CPU after the response, so a
    // fire-and-forget tx stalls (same lesson as syncPoolTrades). At most one
    // request per 30s per instance pays the ~2s; everyone else skips through.
    if (result?.whitelistContractAddress && (allowlistFlushAt.get(id) ?? 0) < Date.now() - 30_000) {
      allowlistFlushAt.set(id, Date.now());
      await flushDropAllowlist(id, result.whitelistContractAddress).catch((e) =>
        console.error(`lazy allowlist flush failed for drop ${id}`, e)
      );
    }
    response.json(result);
  } catch (e) {
    console.log({ e });
    response.status(500);
  }
}

async function getNftContractAddress(artistAddress: string, response: NextApiResponse) {
  console.log(`getNftContractAddress(${artistAddress})`);
  try {
    const result = await prisma.nftContract.upsert({
      where: { artistAddress },
      update: {},
      create: { artistAddress, royaltyPercentage: 12 },
    });
    response.json(result);
  } catch (e) {
    console.log({ e });
    response.status(500);
  }
}

async function getPresetDrops(response: NextApiResponse) {
  const presetDrops = await readPresetDropsFromS3();
  // Populate artists usernames & roles
  const presetArtists = presetDrops.map((item: PresetDrop) => item.artist.walletAddress);
  const dbArtists = await prisma.user.findMany({
    where: { walletAddress: { in: presetArtists } },
    select: { walletAddress: true, username: true, role: true },
  });
  for (const drop of presetDrops) {
    for (const dbArtist of dbArtists) {
      if (drop.artist.walletAddress == dbArtist.walletAddress) {
        drop.artist.username = dbArtist.username;
        drop.artist.role = dbArtist.role;
        break;
      }
    }
  }
  console.log(`getPresetDrops() :: ${presetDrops.length} items`);
  response.json(presetDrops);
}

async function updateNftContractAddress(
  artistAddress: string,
  contractAddress: string,
  response: NextApiResponse
) {
  console.log(`updateNftContractAddress(${artistAddress}, ${contractAddress})`);
  try {
    const result = await prisma.nftContract.update({
      where: { artistAddress },
      data: { contractAddress },
    });
    response.json(result);
  } catch (e) {
    console.log({ e });
    response.status(500);
  }
}

async function optimizeDropImages(id: number, response: NextApiResponse) {
  const drop = await prisma.drop.findUnique({
    where: { id },
    include: {
      Auctions: { include: { Nft: true } },
      OpenEditions: { include: { Nft: true } },
      Lotteries: { include: { Nfts: true } },
    },
  });
  // compile a set of all images that need optimization
  const imgSet = new Set<string>();
  const addToSetIfMeetCriteria = (n: Nft) => {
    if (isVideoSrc(n.s3Path)) return; // must not be a video
    if (n.s3Path != n.s3PathOptimized) return; // must not be already optimized
    if (n.width <= OPTIMIZED_IMAGE_WIDTH) return; // must be larger than optimized width
    imgSet.add(n.s3Path);
  };
  for (const { Nft: n } of drop.Auctions) {
    addToSetIfMeetCriteria(n);
  }
  for (const l of drop.Lotteries) {
    for (const n of l.Nfts) {
      addToSetIfMeetCriteria(n);
    }
  }
  for (const img of Array.from(imgSet)) {
    try {
      const imgOpt = await optimizeImage(img);
      await prisma.nft.updateMany({
        where: { s3Path: img },
        data: { s3PathOptimized: imgOpt },
      });
    } catch (e) {
      console.log(e);
      // ignore errors optimizing single file, on to the next
    }
  }
}

/**
 * Finds deployed Splitter contract address(es) that matches split entries of a given id.
 */
async function findSplitterAddress(id: number, response: NextApiResponse) {
  console.log(`findSplitterAddress(${id})`);
  try {
    var splitEntries = await prisma.splitEntry.findMany({
      where: { splitterId: id },
    });
    if (splitEntries.length! <= 1) {
      response.json([]);
      return;
    }
    // parameterized (values used to be string-concatenated into the SQL);
    // Prisma.join binds each percent/address pair instead of inlining it
    const intersect = splitEntries.map(
      (e) =>
        Prisma.sql`SELECT "splitterId" FROM "SplitEntry" WHERE
        ("percent", "destinationAddress") = (${e.percent}, ${e.destinationAddress})`
    );
    const result = await prisma.$queryRaw(
      Prisma.sql`SELECT "p".* FROM "Splitter" AS "p" JOIN (${Prisma.join(
        intersect,
        ' INTERSECT '
      )}) AS "c"
      ON ("p"."id" = "c"."splitterId") WHERE ("p"."splitterAddress" IS NOT NULL)`
    );
    response.json(result);
  } catch (e) {
    console.log(e);
    response.status(500);
  }
}

async function updateSplitterAddress(id: number, address: string, response: NextApiResponse) {
  console.log(`updateSplitterAddress(${id}, ${address})`);
  try {
    const result = await prisma.splitter.update({
      where: { id },
      data: { splitterAddress: address },
    });
    response.json(result);
  } catch (e) {
    console.log(e);
    response.status(500);
  }
}

async function updateAuctionContractAddress(
  id: number,
  contractAddress: string,
  response: NextApiResponse
) {
  console.log(`updateAuctionContractAddress(${id}, ${contractAddress})`);
  try {
    const result = await prisma.auction.update({
      where: { id },
      data: { contractAddress },
    });
    response.json(result);
  } catch (e) {
    console.log(e);
    response.status(500);
  }
}

async function updateLotteryContractAddress(
  id: number,
  contractAddress: string,
  response: NextApiResponse
) {
  console.log(`updateLotteryContractAddress(${id}, ${contractAddress})`);
  try {
    const result = await prisma.lottery.update({
      where: { id },
      data: { contractAddress },
    });
    response.json(result);
  } catch (e) {
    console.log(e);
    response.status(500);
  }
}

async function updateOpenEditionContractAddress(
  id: number,
  contractAddress: string,
  response: NextApiResponse
) {
  console.log(`updateOpenEditionContractAddress(${id}, ${contractAddress})`);
  try {
    // the on-chain OpenEdition struct's `id` is this row's DB id (see
    // deployOpenEditions in dropsReducer.ts), so editionId == id once deployed
    const result = await prisma.openEdition.update({
      where: { id },
      data: { contractAddress, editionId: id },
    });
    response.json(result);
  } catch (e) {
    console.log(e);
    response.status(500);
  }
}

/**
 * Persists the DEDICATED per-drop SageNFT a collection mints into (deployed
 * client-signed during drop approval, named after the DROP so marketplaces
 * title the collection correctly), then uploads drop-level contract metadata
 * to Arweave and sets contractURI server-side — that call needs storage
 * DEFAULT_ADMIN, which only the platform key holds.
 */
async function updateCollectionNftContract(
  id: number,
  nftContractAddress: string,
  response: NextApiResponse
) {
  console.log(`updateCollectionNftContract(${id}, ${nftContractAddress})`);
  try {
    const cm = await prisma.collectionMint.update({
      where: { id },
      data: { nftContractAddress: nftContractAddress.toLowerCase() },
      include: { Drop: true },
    });
    try {
      const metadata = {
        name: cm.Drop.name,
        description: cm.Drop.description || undefined,
        image: cm.Drop.bannerImageS3Path || undefined,
        external_link: `${process.env.NEXTAUTH_URL}drops/${cm.dropId}`,
        seller_fee_basis_points: Math.round((cm.Drop.royaltyPercentage ?? 12) * 100),
        fee_recipient: nftContractAddress,
      };
      const { tx } = await sendArweaveTransaction(
        'contract-metadata.json',
        Buffer.from(JSON.stringify(metadata), 'utf-8') as any,
        'application/json'
      );
      const txHash = await setContractMetadataOnChain(
        nftContractAddress,
        `https://arweave.net/${tx.id}`
      );
      console.log(`updateCollectionNftContract() :: contractURI set (${txHash})`);
    } catch (e: any) {
      // metadata is display-sugar — its failure must not fail the deploy step
      console.warn(`updateCollectionNftContract() :: contractURI skipped:`, e?.message || e);
    }
    response.json({ ok: true });
  } catch (e) {
    console.log(e);
    response.status(500).json({ error: 'failed to update collection nft contract' });
  }
}

async function updateCollectionContractAddress(
  id: number,
  contractAddress: string,
  response: NextApiResponse
) {
  console.log(`updateCollectionContractAddress(${id}, ${contractAddress})`);
  try {
    // like open editions, the on-chain Collection struct's `id` is this row's
    // DB id (see deployCollectionMints in dropsReducer.ts)
    const result = await prisma.collectionMint.update({
      where: { id },
      data: { contractAddress, collectionId: id },
    });
    response.json(result);
  } catch (e) {
    console.log(e);
    response.status(500);
  }
}

async function updateApprovedDateAndIsLiveFlags(
  id: number,
  walletAddress: string,
  response: NextApiResponse
) {
  console.log(`updateApprovedDateAndIsLiveFlags(${id}, ${walletAddress})`);
  try {
    const { approvedAt } = await prisma.drop.update({
      where: { id: Number(id) },
      data: {
        approvedAt: new Date(),
        approvedBy: walletAddress,
      },
    });
    // Bind games to the configured contracts at approval time: the public drop
    // queries require contractAddress to match the active config, so games left
    // NULL (created before deployment) would silently hide the whole drop.
    await prisma.auction.updateMany({
      where: { dropId: Number(id) },
      data: { isLive: true, contractAddress: parameters.AUCTION_ADDRESS },
    });
    await prisma.lottery.updateMany({
      where: { dropId: Number(id) },
      data: { isLive: true, contractAddress: parameters.LOTTERY_ADDRESS },
    });
    await prisma.openEdition.updateMany({
      where: { dropId: Number(id) },
      data: { isLive: true, contractAddress: parameters.OPENEDITION_ADDRESS },
    });
    await prisma.collectionMint.updateMany({
      where: { dropId: Number(id) },
      data: { isLive: true, contractAddress: parameters.COLLECTION_ADDRESS },
    });
    // object shape — the deploy flow's retry check reads res.data.approvedAt
    // (returning the bare date here made every successful call look failed)
    response.json({ approvedAt });
  } catch (e) {
    console.log(e);
    response.status(500);
  }
}

async function getDropAllowlist(id: number, response: NextApiResponse) {
  console.log(`getDropAllowlist(${id})`);
  try {
    const drop = await prisma.drop.findUnique({
      where: { id },
      select: {
        allowlistEnabled: true,
        whitelistContractAddress: true,
        AllowlistEntries: {
          select: { address: true, syncedAt: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!drop) {
      response.status(404).json({ error: 'drop not found' });
      return;
    }
    response.json({
      enabled: drop.allowlistEnabled,
      whitelistContractAddress: drop.whitelistContractAddress,
      entries: drop.AllowlistEntries,
    });
  } catch (e) {
    console.log(e);
    response.status(500).json({ error: 'failed to load allowlist' });
  }
}

/**
 * Full-replace save that PRESERVES sync state: rows already on the list keep
 * their syncedAt (so a post-deploy save only pushes genuinely new addresses
 * on-chain); rows not in the incoming list are removed.
 */
async function saveDropAllowlist(request: NextApiRequest, response: NextApiResponse) {
  const { dropId, addresses, enabled } = request.body || {};
  console.log(`saveDropAllowlist(${dropId}, ${addresses?.length} addresses, enabled=${enabled})`);
  try {
    if (!Number(dropId) || !Array.isArray(addresses)) {
      response.status(400).json({ error: 'dropId and addresses[] required' });
      return;
    }
    // never trust client-side validation — same parser, server-side
    const { valid, invalid } = parseAddressList(addresses.join('\n'));
    if (invalid.length) {
      response.status(400).json({ error: `invalid addresses: ${invalid.slice(0, 5).join(', ')}` });
      return;
    }
    if (valid.length > ALLOWLIST_MAX_ADDRESSES) {
      response.status(413).json({ error: `allowlist capped at ${ALLOWLIST_MAX_ADDRESSES} addresses` });
      return;
    }
    const id = Number(dropId);
    await prisma.$transaction([
      prisma.dropAllowlistEntry.deleteMany({
        where: { dropId: id, address: { notIn: valid } },
      }),
      prisma.dropAllowlistEntry.createMany({
        data: valid.map((address) => ({ dropId: id, address })),
        skipDuplicates: true, // existing rows keep their syncedAt
      }),
      prisma.drop.update({ where: { id }, data: { allowlistEnabled: !!enabled } }),
    ]);
    const [total, pendingSync] = await Promise.all([
      prisma.dropAllowlistEntry.count({ where: { dropId: id } }),
      prisma.dropAllowlistEntry.count({ where: { dropId: id, syncedAt: null } }),
    ]);
    response.json({ total, pendingSync });
  } catch (e) {
    console.log(e);
    response.status(500).json({ error: 'failed to save allowlist' });
  }
}

/** Records that a chunk of addresses landed on-chain (called per confirmed tx). */
async function markAllowlistSynced(request: NextApiRequest, response: NextApiResponse) {
  const { dropId, addresses, contractAddress } = request.body || {};
  console.log(`markAllowlistSynced(${dropId}, ${addresses?.length} addresses, ${contractAddress})`);
  try {
    if (!Number(dropId) || !Array.isArray(addresses)) {
      response.status(400).json({ error: 'dropId and addresses[] required' });
      return;
    }
    const id = Number(dropId);
    await prisma.dropAllowlistEntry.updateMany({
      where: { dropId: id, address: { in: addresses.map((a: string) => a.toLowerCase()) } },
      data: { syncedAt: new Date() },
    });
    if (contractAddress) {
      await prisma.drop.update({
        where: { id },
        data: { whitelistContractAddress: String(contractAddress).toLowerCase() },
      });
    }
    response.json({ ok: true });
  } catch (e) {
    console.log(e);
    response.status(500).json({ error: 'failed to mark synced' });
  }
}

/**
 * Client IP for gating. Behind Cloudflare (prod) cf-connecting-ip is
 * authoritative; otherwise the LAST x-forwarded-for hop is the one appended
 * by Google's front end (earlier hops are client-supplied and spoofable).
 */
function clientIp(request: NextApiRequest): string | null {
  const cf = request.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const xff = request.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[xff.length - 1] : xff;
  if (!raw) return request.socket?.remoteAddress || null;
  const hops = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return hops[hops.length - 1] || null;
}

/** Salted hash — raw IPs are never stored. */
function hashIp(ip: string): string {
  return createHash('sha256')
    .update(`${process.env.NEXTAUTH_SECRET}:${ip}`)
    .digest('hex');
}

/**
 * One mint spot per network: records a salted-IP claim and adds the wallet
 * to the drop's ON-CHAIN whitelist (platform key signs), so unclaimed
 * wallets revert at the contract even if they bypass the site. Idempotent
 * for the same (network, wallet); rejects a second wallet from the same
 * network. This is a sybil speed bump, not a wall — VPNs rotate IPs.
 */
async function claimMintSpot(
  id: number,
  walletAddress: string,
  request: NextApiRequest,
  response: NextApiResponse
) {
  try {
    const drop = await prisma.drop.findUnique({
      where: { id },
      select: { ipGateEnabled: true, whitelistContractAddress: true },
    });
    if (!drop) {
      response.status(404).json({ error: 'drop not found' });
      return;
    }
    if (!drop.ipGateEnabled) {
      response.json({ claimed: true, gated: false });
      return;
    }
    if (!drop.whitelistContractAddress) {
      response.status(500).json({ error: 'gate misconfigured: no whitelist contract' });
      return;
    }
    const ip = clientIp(request);
    if (!ip) {
      response.status(400).json({ error: 'could not determine client network' });
      return;
    }
    const ipHash = hashIp(ip);
    const wallet = walletAddress.toLowerCase();

    const byIp = await prisma.mintIpClaim.findUnique({
      where: { dropId_ipHash: { dropId: id, ipHash } },
    });
    if (byIp && byIp.walletAddress !== wallet) {
      response
        .status(403)
        .json({ error: 'A mint spot was already claimed from this network.' });
      return;
    }
    const byWallet = await prisma.mintIpClaim.findUnique({
      where: { dropId_walletAddress: { dropId: id, walletAddress: wallet } },
    });
    if (!byIp && !byWallet) {
      try {
        await prisma.mintIpClaim.create({ data: { dropId: id, ipHash, walletAddress: wallet } });
      } catch {
        // unique race — someone else claimed this network between checks
        response
          .status(403)
          .json({ error: 'A mint spot was already claimed from this network.' });
        return;
      }
    }

    // on-chain add (idempotent); ledger entry keeps the AllowlistModal truthful
    if (!(await isWhitelistedOnChain(drop.whitelistContractAddress, wallet))) {
      await addToWhitelistOnChain(drop.whitelistContractAddress, [wallet]);
    }
    await prisma.dropAllowlistEntry.upsert({
      where: { dropId_address: { dropId: id, address: wallet } },
      update: { syncedAt: new Date() },
      create: { dropId: id, address: wallet, syncedAt: new Date() },
    });
    response.json({ claimed: true, gated: true });
  } catch (e: any) {
    console.log(e);
    response.status(500).json({ error: 'failed to claim mint spot' });
  }
}

/**
 * Turns the IP gate ON for a LIVE drop: deploys the drop's SageWhitelist if
 * it doesn't exist yet and points every deployed collection at it — all
 * server-signed (no admin wallet needed). Existing allowlist entries stay
 * valid; new minters come in via ClaimMintSpot.
 */
async function enableIpGate(id: number, response: NextApiResponse) {
  try {
    const drop = await prisma.drop.findUnique({
      where: { id },
      include: { CollectionMints: true },
    });
    if (!drop) {
      response.status(404).json({ error: 'drop not found' });
      return;
    }
    let whitelistContractAddress = drop.whitelistContractAddress;
    if (!whitelistContractAddress) {
      whitelistContractAddress = await deployWhitelistServerSide();
      console.log(`enableIpGate(${id}) :: SageWhitelist deployed to ${whitelistContractAddress}`);
    }
    const wired: string[] = [];
    for (const cm of drop.CollectionMints) {
      if (!cm.contractAddress) continue;
      const tx = await setCollectionWhitelistOnChain(
        cm.collectionId ?? cm.id,
        whitelistContractAddress
      );
      wired.push(`collection ${cm.collectionId ?? cm.id}: ${tx}`);
    }
    await prisma.drop.update({
      where: { id },
      data: { ipGateEnabled: true, whitelistContractAddress },
    });
    response.json({ enabled: true, whitelistContractAddress, wired });
  } catch (e: any) {
    console.log(e);
    response.status(500).json({ error: e?.message || 'failed to enable ip gate' });
  }
}

/**
 * "Can this signed-in wallet buy on this drop?" — wallet comes from the JWT
 * (requester), never the query string, so it can't be spoofed. Ungated drops
 * always answer allowed.
 */
/**
 * Voucher-gated minting: an eligible wallet requests a short-lived,
 * per-wallet voucher for a specific open edition or lottery. The server
 * checks eligibility off-chain (the same DropAllowlistEntry ledger that
 * admin-allowlist, follow-gate and IP-gate claims all write to), then signs
 * a voucher the wallet redeems itself via batchMintWithVoucher /
 * buyTicketsWithVoucher — no on-chain whitelist write, zero server gas. The
 * contract re-verifies the signature and binds it to msg.sender + chain +
 * contract + drop + expiry, so a leaked voucher is useless to anyone else.
 */
async function getGameVoucher(
  request: NextApiRequest,
  walletAddress: string,
  response: NextApiResponse
) {
  const game = String(request.query.game || ''); // 'oe' | 'lottery'
  const recordId = Number(request.query.recordId);
  if (!recordId || (game !== 'oe' && game !== 'lottery')) {
    response.status(400).json({ error: "game ('oe'|'lottery') and recordId required" });
    return;
  }
  // resolve the game contract + on-chain id + owning drop
  let dropId: number, contractAddress: string | null, onchainId: number | null;
  if (game === 'oe') {
    const oe = await prisma.openEdition.findUnique({ where: { id: recordId }, select: { dropId: true, contractAddress: true, editionId: true } });
    if (!oe) { response.status(404).json({ error: 'open edition not found' }); return; }
    ({ dropId, contractAddress } = oe);
    onchainId = oe.editionId;
  } else {
    const lot = await prisma.lottery.findUnique({ where: { id: recordId }, select: { dropId: true, contractAddress: true } });
    if (!lot) { response.status(404).json({ error: 'lottery not found' }); return; }
    dropId = lot.dropId;
    contractAddress = lot.contractAddress;
    onchainId = recordId; // the on-chain lotteryID is the DB id
  }
  if (!contractAddress || onchainId === null) {
    response.status(409).json({ error: 'this drop is not deployed on-chain yet' });
    return;
  }
  // eligibility: allowlisted for this drop (covers admin allowlist, follow-gate
  // and IP-gate claims — all land in DropAllowlistEntry). An ungated drop
  // shouldn't be voucher-gated, so absence of a gate = not eligible here.
  const entry = await prisma.dropAllowlistEntry.findUnique({
    where: { dropId_address: { dropId, address: walletAddress.toLowerCase() } },
  });
  if (!entry) {
    response.status(403).json({ error: 'not eligible for this drop' });
    return;
  }
  const chainId = Number(parameters.CHAIN_ID);
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1h to submit the mint
  const signature =
    game === 'oe'
      ? await signOpenEditionVoucher(chainId, contractAddress, walletAddress, onchainId, deadline)
      : await signLotteryVoucher(chainId, contractAddress, walletAddress, onchainId, deadline);
  response.json({ signature, deadline, contractAddress, onchainId });
}

async function checkDropAllowlist(id: number, walletAddress: string, response: NextApiResponse) {
  try {
    const drop = await prisma.drop.findUnique({
      where: { id },
      select: { allowlistEnabled: true },
    });
    if (!drop) {
      response.status(404).json({ error: 'drop not found' });
      return;
    }
    if (!drop.allowlistEnabled) {
      response.json({ gated: false, allowed: true });
      return;
    }
    const entry = await prisma.dropAllowlistEntry.findUnique({
      where: { dropId_address: { dropId: id, address: walletAddress.toLowerCase() } },
    });
    response.json({ gated: true, allowed: !!entry });
  } catch (e) {
    console.log(e);
    response.status(500).json({ error: 'failed to check allowlist' });
  }
}

/** Pulls a 43-char Arweave txid out of an arweave.net URL, or null. */
function arweaveTxid(url?: string | null): string | null {
  const m = url ? /arweave\.net\/([A-Za-z0-9_-]{43})/.exec(url) : null;
  return m ? m[1] : null;
}

async function deleteDrop(id: number, response: NextApiResponse) {
  console.log(`deleteDrop(${id})`);
  const drop = await prisma.drop.findUnique({
    where: { id },
    include: {
      Auctions: { include: { Nft: true } },
      OpenEditions: { include: { Nft: true } },
      Lotteries: { include: { Nfts: true } },
      CollectionMints: true,
    },
  });
  if (!drop) {
    response.status(404);
    return;
  }
  if (drop.approvedAt) {
    response.status(500);
    return;
  }

  // Collect every display-only S3 mirror this drop is responsible for, so it
  // can be cleaned up AFTER the DB rows are gone (below). The mirror is keyed
  // by Arweave txid; a re-upload gets fresh txids, so leaving these behind
  // just accumulates orphans in the bucket. Media only — NFT metadata is
  // never mirrored (collections are the exception: they mirror image, JSON
  // AND manifest, so all three are reclaimed here).
  const mirrorTxids: string[] = [];
  const addFromUrl = (u?: string | null) => {
    const t = arweaveTxid(u);
    if (t) mirrorTxids.push(t);
  };
  // banner + its variants live on the drop row
  addFromUrl(drop.bannerImageS3Path);
  addFromUrl(drop.tileImageS3Path);
  addFromUrl(drop.mobileCoverS3Path);
  addFromUrl(drop.featuredMediaS3Path);
  const nfts = [
    ...drop.Auctions.map((a) => a.Nft),
    ...drop.Lotteries.flatMap((l) => l.Nfts),
    ...drop.OpenEditions.map((oe) => oe.Nft),
  ].filter(Boolean);
  for (const n of nfts) {
    addFromUrl(n!.arweavePath);
    addFromUrl(n!.s3Path);
    addFromUrl(n!.s3PathOptimized); // optimized rendition is a separate mirror
  }
  for (const cm of drop.CollectionMints) {
    if (cm.manifestId) mirrorTxids.push(cm.manifestId);
    if (cm.pathMap) {
      try {
        const map = JSON.parse(cm.pathMap) as Record<string, { img?: string; json?: string }>;
        for (const e of Object.values(map)) {
          if (e.img) mirrorTxids.push(e.img);
          if (e.json) mirrorTxids.push(e.json);
        }
      } catch {
        /* malformed pathMap — skip its images, still clean everything else */
      }
    }
  }

  for (const a of drop.Auctions) {
    await prisma.auction.delete({ where: { id: a.id } });
    await prisma.nft.delete({ where: { id: a.nftId } });
  }
  for (const l of drop.Lotteries) {
    for (const n of l.Nfts) {
      await prisma.nft.delete({ where: { id: n.id } });
    }
    await prisma.lottery.delete({ where: { id: l.id } });
  }
  for (const oe of drop.OpenEditions) {
    await prisma.openEdition.delete({ where: { id: oe.id } });
    await prisma.nft.delete({ where: { id: oe.nftId } });
  }
  // CollectionMint rows FK to the drop — must go before the drop delete (this
  // path previously didn't handle them at all, so deleting a collection draft
  // FK-failed)
  await prisma.collectionMint.deleteMany({ where: { dropId: id } });
  // allowlist entries reference the drop — must go first or the FK blocks this
  await prisma.dropAllowlistEntry.deleteMany({ where: { dropId: id } });
  await prisma.drop.delete({ where: { id } });

  // Best-effort mirror cleanup — AFTER the DB delete succeeds so a slow/failed
  // S3 call can never strand a half-deleted drop (deleteFromS3Mirror never
  // throws). Orphaned mirrors are harmless (display-only), so DB is the
  // source of truth for what's gone. Outer handler sends the response.
  await deleteFromS3Mirror(mirrorTxids);
  console.log(`deleteDrop(${id}) :: removed ${mirrorTxids.length} S3 mirror object(s)`);
}

async function deleteDrops(response: NextApiResponse) {
  console.log(`deleteDrops()`);
  if (process.env.NEXT_PUBLIC_APP_MODE == 'production') {
    throw new Error('Web wiping of drop data not allowed in production');
  }
  await prisma.config.updateMany({ where: {}, data: { featuredDropId: null } });
  await prisma.refund.deleteMany();
  await prisma.saleEvent.deleteMany();
  await prisma.prizeProof.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.bidHistory.deleteMany();
  await prisma.auction.deleteMany();
  await prisma.nft.deleteMany();
  await prisma.lottery.deleteMany();
  await prisma.dropAllowlistEntry.deleteMany();
  await prisma.drop.deleteMany();
}

async function optimizeImage(path: string): Promise<string> {
  console.log(`optimizeImage(${path})`);
  // retrieve source file from S3
  const fetchResponse = await fetch(path);
  const inputBuffer = new Uint8Array(await fetchResponse.arrayBuffer());
  // use 'sharp' to reduce image size
  const outputBuffer: Buffer = await sharp(inputBuffer)
    .jpeg()
    .resize(OPTIMIZED_IMAGE_WIDTH)
    .toBuffer();
  // parse original path and store optimized file in the same bucket/folder with '_opt' suffix
  // sample url: https://dev-sage.s3.us-east-2.amazonaws.com/1666901994984/nft_1.png
  const inputPathParts = path.split('/');
  const inputFilenameParts = inputPathParts.pop().split('.');
  const dstFolder = inputPathParts.pop();
  // Filebase/IPFS gateway paths are bare CIDs with no extension — the output
  // is always sharp-encoded JPEG anyway, so fall back to 'jpg' instead of
  // producing a literal "_opt.undefined" filename.
  const outputFilename = inputFilenameParts[0] + '_opt.' + (inputFilenameParts[1] || 'jpg');
  const s3PathOptimized = await uploadBufferToS3(
    dstFolder,
    outputFilename,
    'image/jpeg',
    outputBuffer
  );
  return s3PathOptimized;
}

export default handler;
