import { NextApiRequest, NextApiResponse } from 'next';
import { Nft, Prisma, Role } from '@prisma/client';
import { readPresetDropsFromS3, uploadBufferToS3 } from '@/utilities/awsS3-server';
import { isVideoSrc } from '@/utilities/media';
import { PresetDrop } from '@/store/dropsReducer';
import { withArtistDisplayNameOverride } from '@/prisma/functions';
import { requireRole } from '@/utilities/apiAuth';
import { parseAddressList, ALLOWLIST_MAX_ADDRESSES } from '@/utilities/allowlist';
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
  GetNftContractAddress: [Role.ARTIST, Role.ADMIN],
  GetDropsPendingApproval: [Role.ADMIN],
  GetPresetDrops: [Role.ADMIN],
  FindSplitterAddress: [Role.ADMIN],
  OptimizeDropImages: [Role.ADMIN],
  UpdateNftContractAddress: [Role.ADMIN],
  UpdateSplitterAddress: [Role.ADMIN],
  UpdateAuctionContractAddress: [Role.ADMIN],
  UpdateLotteryContractAddress: [Role.ADMIN],
  UpdateOpenEditionContractAddress: [Role.ADMIN],
  UpdateApprovedDateAndIsLiveFlags: [Role.ADMIN],
  DeleteDrop: [Role.ADMIN],
  DeleteDrops: [Role.ADMIN],
  // Per-drop allowlist gating. Admin manages the list; CheckDropAllowlist is
  // broad because every signed-in visitor needs to learn "am I allowed to buy"
  // (the wallet is taken from the JWT, never from the query — not spoofable).
  GetDropAllowlist: [Role.ADMIN],
  SaveDropAllowlist: [Role.ADMIN],
  MarkAllowlistSynced: [Role.ADMIN],
  CheckDropAllowlist: [Role.USER, Role.ARTIST, Role.ADMIN],
};

async function handler(request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { action, id, address },
  } = request;
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
      },
      orderBy: {
        id: 'desc',
      },
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
      },
    });
    result.forEach(withArtistDisplayNameOverride);
    response.json(result);
  } catch (e) {
    console.log({ e });
    response.status(500);
  }
}

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
      },
    });
    if (result) withArtistDisplayNameOverride(result);
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
    var queryParams = '';
    for (var i = 0; i < splitEntries.length; i++) {
      queryParams += `SELECT "splitterId" FROM "SplitEntry" WHERE
        ("percent", "destinationAddress") = (${splitEntries[i].percent}, '${splitEntries[i].destinationAddress}')`;
      if (i != splitEntries.length - 1) {
        queryParams += ` INTERSECT `;
      }
    }
    const query = `SELECT "p".* FROM "Splitter" AS "p" JOIN (${queryParams}) AS "c"
      ON ("p"."id" = "c"."splitterId") WHERE ("p"."splitterAddress" IS NOT NULL)`;
    const result = await prisma.$queryRaw(Prisma.raw(query));
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
 * "Can this signed-in wallet buy on this drop?" — wallet comes from the JWT
 * (requester), never the query string, so it can't be spoofed. Ungated drops
 * always answer allowed.
 */
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

async function deleteDrop(id: number, response: NextApiResponse) {
  console.log(`deleteDrop(${id})`);
  const drop = await prisma.drop.findUnique({
    where: { id },
    include: {
      Auctions: { include: { Nft: true } },
      OpenEditions: { include: { Nft: true } },
      Lotteries: { include: { Nfts: true } },
    },
  });
  if (drop?.approvedAt) {
    response.status(500);
    return;
  }
  for (const a of drop?.Auctions!) {
    await prisma.auction.delete({ where: { id: a.id } });
    await prisma.nft.delete({ where: { id: a.nftId } });
  }
  for (const l of drop?.Lotteries!) {
    for (const n of l.Nfts) {
      await prisma.nft.delete({ where: { id: n.id } });
    }
    await prisma.lottery.delete({ where: { id: l.id } });
  }
  // allowlist entries reference the drop — must go first or the FK blocks this
  await prisma.dropAllowlistEntry.deleteMany({ where: { dropId: id } });
  await prisma.drop.delete({ where: { id } });
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
  const outputFilename = inputFilenameParts[0] + '_opt.' + inputFilenameParts[1];
  const s3PathOptimized = await uploadBufferToS3(
    dstFolder,
    outputFilename,
    'image/jpeg',
    outputBuffer
  );
  return s3PathOptimized;
}

export default handler;
