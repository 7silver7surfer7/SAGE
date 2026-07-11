import type { NextApiRequest, NextApiResponse } from 'next';
import NextCors from 'nextjs-cors';
import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { Role } from '@prisma/client';
import { createS3SignedUrl } from '@/utilities/awsS3-server';
import {
  estimateUploadCostAR,
  getArweaveBalance,
  sendArweaveTransaction,
  signChunkedUploadTx,
} from '@/utilities/arweave-server';
import {
  processCollectionZip,
  BatchCheckpoint,
  CollectionProgress,
} from '@/utilities/collectionBundler';
import { mirrorToS3, s3MirrorUrl } from '@/utilities/s3Mirror';
import { getRequester, requireRole, Requester } from '@/utilities/apiAuth';
import { parameters } from '@/constants/config';
import OpenEditionJson from '@/constants/abis/OpenEdition/SAGEOpenEdition.sol/SAGEOpenEdition.json';

// Role required per action. Drop/game creation is dashboard-only (ADMIN);
// NFT records and metadata uploads are also used by the artist mint flow.
// RegisterOpenEditionMint is open to any signed-in wallet — it's how a
// collector's own open-edition mint gets recorded so it shows in "My
// Collection"; the handler independently verifies on-chain ownership before
// writing anything, so a plain USER role here isn't a trust concession.
const ACTION_ROLES: Record<string, Role[]> = {
  GetArtistNftContractAddress: [Role.ARTIST, Role.ADMIN],
  // also used by uploadLargeFileToArweave's browser-direct S3 mirror step —
  // the server never sees bytes for >25MB uploads, so the signed-PUT dance
  // this action provides is how the browser mirrors those bytes to S3 too
  CreateS3SignedUrl: [Role.ADMIN],
  CopyFromS3toArweave: [Role.ADMIN], // legacy S3 path, unused by current UI
  // deploy-time backstop: pushes a display-only S3 mirror for a txid whose
  // upload-time mirror write failed (see src/utilities/s3Mirror.ts)
  EnsureS3Mirror: [Role.ADMIN],
  UploadNftMetadataToArweave: [Role.ARTIST, Role.ADMIN],
  InsertDrop: [Role.ADMIN],
  InsertAuction: [Role.ADMIN],
  InsertOpenEdition: [Role.ADMIN],
  InsertDrawing: [Role.ADMIN],
  // Draft editing: fix names/prices, remove an artwork, or add media to a
  // saved (unapproved) drop WITHOUT deleting and re-uploading everything —
  // media already on Arweave is paid for and stays; only new files cost AR.
  UpdateDraftArtwork: [Role.ADMIN],
  DeleteDraftArtwork: [Role.ADMIN],
  // Collection drops (ZIP → bulk sequential mint)
  InsertCollectionMint: [Role.ADMIN],
  ProcessCollectionZip: [Role.ADMIN],
  GetCollectionStatus: [Role.ADMIN],
  RegisterCollectionMint: [Role.USER, Role.ARTIST, Role.ADMIN], // ownership verified on-chain below
  InsertNft: [Role.ARTIST, Role.ADMIN],
  DeleteNft: [Role.ARTIST, Role.ADMIN], // additionally scoped to own NFTs below
  RegisterOpenEditionMint: [Role.USER, Role.ARTIST, Role.ADMIN],
  // signs Arweave tx headers so big media (>32MB — Cloud Run's edge rejects
  // such request bodies outright) can be uploaded browser→Arweave directly;
  // same trust level as the regular upload endpoint (we pay for storage)
  SignArweaveTx: [Role.ARTIST, Role.ADMIN],
};

async function handler(request: NextApiRequest, response: NextApiResponse) {
  await setupCors(request, response);
  const {
    query: { action },
  } = request;
  const allowedRoles = ACTION_ROLES[String(action)];
  if (!allowedRoles) {
    response.status(400).json('Bad Request');
    response.end();
    return;
  }
  const requester = await requireRole(request, response, allowedRoles);
  if (!requester) {
    response.end();
    return;
  }
  switch (action) {
    case 'GetArtistNftContractAddress':
      await getArtistNftContractAddress(String(request.query.artistAddress), response);
      break;
    case 'CreateS3SignedUrl':
      await getS3SignedUrl(
        String(request.query.bucket),
        String(request.query.filename),
        response
      );
      break;
    case 'CopyFromS3toArweave':
      await copyFromS3toArweave(String(request.query.s3Path), response);
      break;
    case 'EnsureS3Mirror':
      await ensureS3Mirror(String(request.query.txid), response);
      break;
    case 'UploadNftMetadataToArweave':
      await uploadNftMetadataToArweave(request.body, response);
      break;
    case 'InsertDrop':
      await insertDrop(request.body, response);
      break;
    case 'InsertAuction':
      await insertAuction(request.body, response);
      break;
    case 'InsertOpenEdition':
      await insertOpenEdition(request.body, response);
      break;
    case 'InsertDrawing':
      await insertDrawing(request.body, response);
      break;
    case 'UpdateDraftArtwork':
      await updateDraftArtwork(request.body, response);
      break;
    case 'DeleteDraftArtwork':
      await deleteDraftArtwork(request.body, response);
      break;
    case 'InsertCollectionMint':
      await insertCollectionMint(request.body, response);
      break;
    case 'ProcessCollectionZip':
      await processCollectionZipAction(Number(request.query.id), response);
      break;
    case 'GetCollectionStatus':
      await getCollectionStatus(Number(request.query.id), response);
      break;
    case 'RegisterCollectionMint':
      await registerCollectionMint(request.body, requester, response);
      break;
    case 'InsertNft':
      await insertNft(request.body, response);
      break;
    case 'DeleteNft':
      await deleteNft(Number(request.query.id), request, response);
      break;
    case 'RegisterOpenEditionMint':
      await registerOpenEditionMint(request.body, requester, response);
      break;
    case 'SignArweaveTx':
      await signArweaveTx(request.body, response);
      break;
  }
  response.end();
}

// media types the app accepts for drop artwork (see CreateDropPanel)
const SIGNABLE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'video/mp4',
]);
const MAX_SIGNABLE_BYTES = 500 * 1024 * 1024; // cost guard: 500MB per file

async function signArweaveTx(data: any, response: NextApiResponse) {
  try {
    const dataSize = Number(data.dataSize);
    const dataRoot = String(data.dataRoot || '');
    const contentType = String(data.contentType || '');
    if (!Number.isInteger(dataSize) || dataSize <= 0 || dataSize > MAX_SIGNABLE_BYTES) {
      response.status(400).json({ error: 'invalid dataSize' });
      return;
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(dataRoot)) {
      response.status(400).json({ error: 'invalid dataRoot' });
      return;
    }
    if (!SIGNABLE_CONTENT_TYPES.has(contentType)) {
      response.status(400).json({ error: `unsupported content type '${contentType}'` });
      return;
    }
    const { tx, balance } = await signChunkedUploadTx(dataSize, dataRoot, contentType);
    response.json({ tx, balance });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

async function setupCors(request: NextApiRequest, response: NextApiResponse) {
  await NextCors(request, response, {
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    origin: '*',
    optionsSuccessStatus: 200,
  });
}

async function getArtistNftContractAddress(artistAddress: string, response: NextApiResponse) {
  const result = await prisma.nftContract.findUnique({
    where: { artistAddress }
  });
  const nftContractAddress = result ? result.contractAddress : null;
  response.json({nftContractAddress});
}

async function getS3SignedUrl(folder: string, filename: string, response: NextApiResponse) {
  const { uploadUrl, getUrl } = createS3SignedUrl(folder, filename);
  response.json({ uploadUrl, getUrl });
}

async function copyFromS3toArweave(s3Path: string, response: NextApiResponse) {
  var balance = '';
  try {
    const fileContent = await fetchFileContent(s3Path);
    const filename = s3Path.split('/').pop() as string;
    const { tx, balance } = await sendArweaveTransaction(
      filename,
      fileContent,
      inferMimeType(s3Path)
    );
    response.json({ id: tx.id, balance });
  } catch (e: any) {
    console.log(e);
    response.json({ error: (e as Error).message, balance });
  }
}

const TXID_RE = /^[A-Za-z0-9_-]{43}$/; // base64url tx id — also SSRF guard

/**
 * Deploy-time backstop for the S3 display-mirror: if a txid's upload-time
 * mirror write failed (network blip, etc.), re-derive it here by fetching
 * the bytes straight from Arweave — by the time this runs in deployDrop, the
 * pre-mint gate has just confirmed the txid IS retrievable from Arweave — and
 * pushing them to S3. Best-effort: always responds 200 with a `mirrored`
 * flag rather than an HTTP error, so a failure here never blocks a deploy
 * that already succeeded on-chain.
 */
async function ensureS3Mirror(txid: string, response: NextApiResponse) {
  if (!TXID_RE.test(txid)) {
    response.status(400).json({ error: 'invalid transaction id' });
    return;
  }
  try {
    const head = await fetch(s3MirrorUrl(txid), { method: 'HEAD' });
    if (head.ok) {
      response.json({ mirrored: true, alreadyExisted: true });
      return;
    }
    const arRes = await fetch(`https://arweave.net/${txid}`);
    if (!arRes.ok || !arRes.body) {
      response.json({ mirrored: false, error: `Arweave fetch failed (${arRes.status})` });
      return;
    }
    const contentType = arRes.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await arRes.arrayBuffer());
    await mirrorToS3(txid, contentType, buffer);
    response.json({ mirrored: true, alreadyExisted: false });
  } catch (e: any) {
    console.log(e);
    response.json({ mirrored: false, error: (e as Error).message });
  }
}

async function uploadNftMetadataToArweave(nftMetadataFile: any, response: NextApiResponse) {
  var metadataType = 'application/json';
  const { tx, balance } = await sendArweaveTransaction(
    nftMetadataFile.filename,
    nftMetadataFile.data,
    metadataType
  );
  response.json({ id: tx.id, balance });
}

/**
 * Manifests are used for 1155's
 * Based upon https://github.com/ArweaveTeam/arweave/wiki/Path-Manifests#schema
 */
function createArweaveManifest(nftMetadataFiles: any[]): string {
  var paths = '';
  for (var i = 0; i < nftMetadataFiles.length; i++) {
    paths += `\n      "${nftMetadataFiles[i].filename}": { "id": "${nftMetadataFiles[i].txId}" }`;
    paths += i < nftMetadataFiles.length - 1 ? ',' : '\n     ';
  }
  var manifest = `
  {
    "manifest": "arweave/paths",
    "version": "0.1.0",
    "paths": { ${paths} }
  }
  `;
  return manifest;
}

async function insertDrop(data: any, response: NextApiResponse) {
  console.log('insertDrop()');
  try {
    // Hard gate on the artist wallet: it gets baked into the NFT contract at
    // deploy and receives the artist share of every sale — an invalid or
    // typo'd address burns those funds permanently (isAddress also enforces
    // the EIP-55 checksum on mixed-case input). Normalize to checksummed form.
    if (typeof data.artistWallet !== 'string' || !ethers.utils.isAddress(data.artistWallet)) {
      response.json({ error: 'Invalid artist wallet address' });
      return;
    }
    data.artistWallet = ethers.utils.getAddress(data.artistWallet);
    // Create user if it doesn't exist. Site-wide username is untouched here —
    // an optional per-drop display name (artistDisplayName below) is stored
    // on the Drop itself instead, so it doesn't rename the wallet's profile.
    // An uploaded artist icon DOES update the profile: it becomes the
    // artist's profilePicture so the default SAGE icon stops showing.
    const artistProfilePicture =
      typeof data.artistProfilePicture === 'string' && data.artistProfilePicture.trim()
        ? data.artistProfilePicture.trim()
        : null;
    await prisma.user.upsert({
      where: {
        walletAddress: data.artistWallet,
      },
      update: artistProfilePicture ? { profilePicture: artistProfilePicture } : {},
      create: {
        walletAddress: data.artistWallet,
        role: Role.ARTIST,
        ...(artistProfilePicture ? { profilePicture: artistProfilePicture } : {}),
      },
    });
    // Create nft contract record if it doesn't exist
    const defaultRoyalty = 12;
    const royalty = parseFloat(data.rltyPercent);
    await prisma.nftContract.upsert({
      where: { artistAddress: data.artistWallet },
      update: {},
      create: {
        artistAddress: data.artistWallet,
        royaltyPercentage: isNaN(royalty) ? defaultRoyalty : royalty,
      },
    });
    // Secondary-sale royalty, PERCENT units; stamped on-chain (as bps) at
    // drop deploy. Server-side clamp mirrors the dashboard's 0-20 bound.
    const dropRoyalty = parseFloat(data.royaltyPercentage);
    const royaltyPercentage =
      isNaN(dropRoyalty) ? 12 : Math.min(Math.max(dropRoyalty, 0), 20);
    // Create drop
    var record = await prisma.drop.create({
      data: {
        name: data.name,
        description: data.description || '',
        createdAt: new Date(),
        bannerImageS3Path: data.bannerImageS3Path,
        goLiveAt: data.goLiveAt ? new Date(Number(data.goLiveAt) * 1000) : null,
        tileImageS3Path: data.tileImageS3Path || null,
        featuredMediaS3Path: data.featuredMediaS3Path || null,
        mobileCoverS3Path: data.mobileCoverS3Path || null,
        artistDisplayName: data.artistDisplayName?.trim() || null,
        royaltyPercentage,
        NftContract: { connect: { artistAddress: data.artistWallet } },
      },
    });
    response.json({ dropId: record.id });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

// Resolves a Drop's per-drop artist display name so it can be snapshotted
// onto each Nft created for it — see Nft.artistDisplayName in schema.prisma.
async function getDropArtistDisplayName(dropId: number): Promise<string | null> {
  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    select: { artistDisplayName: true },
  });
  return drop?.artistDisplayName || null;
}

async function insertAuction(data: any, response: NextApiResponse) {
  console.log('insertAuction()');
  if (data.endDate) {
    var endTime = new Date(Number(data.endDate) * 1000);
  } else {
    var duration = data.duration ? data.duration : 24*60*60;
    var endTime = new Date((Number(data.startDate) + duration) * 1000);
  }
  try {
    const dropId = Number(data.dropId);
    const artistDisplayName = await getDropArtistDisplayName(dropId);
    var record = await prisma.auction.create({
      data: {
        Drop: { connect: { id: dropId } },
        // contractAddress stays null until the on-chain createAuction runs —
        // deployAuctions uses it as the "already deployed" marker, so setting
        // it here made the deploy step silently skip every auction.
        minimumPrice: data.minPrice,
        startTime: new Date(Number(data.startDate) * 1000),
        endTime,
        Nft: {
          create: {
            name: data.name,
            description: data.description || '',
            // tags: data.tags || '',
            numberOfEditions: 1,
            metadataPath: data.metadataPath || null,
            arweavePath: data.arweavePath,
            width: data.width ? Number(data.width) : null,
            height: data.height ? Number(data.height) : null,
            s3Path: data.s3Path,
            s3PathOptimized: data.s3PathOptimized || data.s3Path,
            artistDisplayName,
          },
        },
      },
    });
    response.json({ auctionId: record.id, nftId: record.nftId });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

async function insertOpenEdition(data: any, response: NextApiResponse) {
  console.log('insertOpenEdition()');
  try {
    const dropId = Number(data.dropId);
    const artistDisplayName = await getDropArtistDisplayName(dropId);
    var record = await prisma.openEdition.create({
      data: {
        Drop: { connect: { id: dropId } },
        // null until on-chain createOpenEdition runs — deployOpenEditions
        // treats a non-null contractAddress as "already deployed" and skips
        costTokens: toNumber(data.costTokens),
        costPoints: toNumber(data.costPoints),
        maxPerUser: toNumber(data.maxPerUser),
        startTime: new Date(Number(data.startDate) * 1000),
        endTime: new Date(Number(data.endDate) * 1000),
        Nft: {
          create: {
            name: data.name,
            description: data.description || '',
            numberOfEditions: 0, // open edition: unbounded, minted on demand
            metadataPath: data.metadataPath || null,
            arweavePath: data.arweavePath,
            width: data.width ? Number(data.width) : null,
            height: data.height ? Number(data.height) : null,
            s3Path: data.s3Path,
            s3PathOptimized: data.s3PathOptimized || data.s3Path,
            artistDisplayName,
          },
        },
      },
    });
    response.json({ openEditionId: record.id, nftId: record.nftId });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

async function insertNft(data: any, response: NextApiResponse) {
  console.log('insertNft()');
  try {
    var insertData = {
      data: {
        name: data.name,
        tokenId: data.tokenId || null,
        description: data.description || '',
        // tags: data.tags || '',
        numberOfEditions: toNumber(data.numberOfEditions),
        metadataPath: data.metadataPath || null,
        arweavePath: data.arweavePath,
        width: data.width ? Number(data.width) : null,
        height: data.height ? Number(data.height) : null,
        s3Path: data.s3Path,
        s3PathOptimized: data.s3PathOptimized || data.s3Path,
        price: data.price || undefined,
        Auction: null || {},
        Lottery: null || {},
        NftContract: null || {},
      },
    };
    // Game NFT either belongs to an Auction or to a Lottery
    if (data.auctionId) {
      insertData.data.Auction = { connect: { id: data.auctionId } };
    } else if (data.drawingId) {
      insertData.data.Lottery = { connect: { id: data.drawingId } };
      const lottery = await prisma.lottery.findUnique({
        where: { id: Number(data.drawingId) },
        select: { dropId: true },
      });
      if (lottery) {
        (insertData.data as any).artistDisplayName = await getDropArtistDisplayName(
          lottery.dropId
        );
      }
    }
    if (data.artistAddress) { // Artist listing
      insertData.data.NftContract = { connect: { artistAddress: data.artistAddress } };
    }
    var record = await prisma.nft.create(insertData);
    response.json({ nftId: record.id });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

/**
 * Open edition mints happen entirely on-chain (batchMint/claimPointsAndMint
 * mint a fresh token straight to the caller's wallet) — nothing tells the DB
 * a mint happened, so the shared OpenEdition.Nft "listing" row never gets an
 * ownerAddress and the mint can never show up in anyone's Collection page.
 * Called by the mint modal right after its transaction confirms; verifies
 * on-chain ownership of the claimed tokenId before writing anything, since
 * the tokenId itself is client-supplied and can't be trusted blindly.
 */
async function registerOpenEditionMint(
  data: { openEditionId: number; tokenId: number },
  requester: Requester,
  response: NextApiResponse
) {
  console.log(
    `registerOpenEditionMint(${data.openEditionId}, ${data.tokenId}, ${requester.walletAddress})`
  );
  try {
    const openEdition = await prisma.openEdition.findUnique({
      where: { id: Number(data.openEditionId) },
      include: { Nft: true, Drop: { include: { NftContract: true } } },
    });
    if (!openEdition) {
      response.status(404).json({ error: 'Open edition not found' });
      return;
    }
    const nftContractAddress = openEdition.Drop.NftContract.contractAddress;
    if (!nftContractAddress) {
      response.status(400).json({ error: 'Artist NFT contract not deployed yet' });
      return;
    }
    const tokenId = Number(data.tokenId);
    const provider = new ethers.providers.StaticJsonRpcProvider(
      parameters.RPC_URL,
      +parameters.CHAIN_ID
    );
    const nftContract = new ethers.Contract(
      nftContractAddress,
      ['function ownerOf(uint256) view returns (address)'],
      provider
    );
    const onChainOwner: string = await nftContract.ownerOf(tokenId);
    if (onChainOwner.toLowerCase() !== requester.walletAddress.toLowerCase()) {
      response.status(403).json({ error: 'Token is not owned by the requesting wallet' });
      return;
    }
    // Keep the DB's mintCount in sync with the contract — it's otherwise
    // only ever set once at deploy time and never updated again. Reading
    // fresh from chain (rather than incrementing) makes this idempotent
    // however many times registration is called.
    if (openEdition.contractAddress) {
      try {
        const editionContract = new ethers.Contract(
          openEdition.contractAddress,
          OpenEditionJson.abi,
          provider
        );
        const onChainEdition = await editionContract.getOpenEdition(
          openEdition.editionId ?? openEdition.id
        );
        await prisma.openEdition.update({
          where: { id: openEdition.id },
          data: { mintCount: Number(onChainEdition.mintCount) },
        });
      } catch (e) {
        console.error(`Failed to sync mintCount for openEdition ${openEdition.id}`, e);
      }
    }
    // idempotent: a retried registration for the same token must not create a duplicate row
    const existing = await prisma.nft.findFirst({
      where: { tokenId, artistAddress: openEdition.Drop.artistAddress },
    });
    if (existing) {
      response.json({ nftId: existing.id });
      return;
    }
    const record = await prisma.nft.create({
      data: {
        name: openEdition.Nft.name,
        description: openEdition.Nft.description,
        tokenId,
        metadataPath: openEdition.Nft.metadataPath,
        arweavePath: openEdition.Nft.arweavePath,
        s3Path: openEdition.Nft.s3Path,
        s3PathOptimized: openEdition.Nft.s3PathOptimized,
        width: openEdition.Nft.width,
        height: openEdition.Nft.height,
        numberOfEditions: 1,
        ownerAddress: requester.walletAddress,
        artistAddress: openEdition.Drop.artistAddress,
        artistDisplayName: openEdition.Drop.artistDisplayName,
      },
    });
    response.json({ nftId: record.id });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

/**
 * Draft-only guard shared by the artwork edit/delete actions: the parent drop
 * must be unapproved and the game not yet deployed on-chain. Editing a LIVE
 * game's parameters would desync the DB from the contract (prices/supply are
 * baked on-chain at deploy), so those are refused outright.
 */
async function assertDraftGame(
  gameType: string,
  gameId: number
): Promise<{ ok: boolean; error?: string; nftIds: number[] }> {
  if (gameType === 'auction') {
    const g = await prisma.auction.findUnique({ where: { id: gameId }, include: { Drop: true } });
    if (!g) return { ok: false, error: 'Auction not found', nftIds: [] };
    if (g.Drop.approvedAt || g.contractAddress)
      return { ok: false, error: 'Drop is already approved/deployed — draft edits only', nftIds: [] };
    return { ok: true, nftIds: [g.nftId] };
  }
  if (gameType === 'lottery') {
    const g = await prisma.lottery.findUnique({
      where: { id: gameId },
      include: { Drop: true, Nfts: true },
    });
    if (!g) return { ok: false, error: 'Drawing not found', nftIds: [] };
    if (g.Drop.approvedAt || g.contractAddress)
      return { ok: false, error: 'Drop is already approved/deployed — draft edits only', nftIds: [] };
    return { ok: true, nftIds: g.Nfts.map((n) => n.id) };
  }
  if (gameType === 'openEdition') {
    const g = await prisma.openEdition.findUnique({
      where: { id: gameId },
      include: { Drop: true },
    });
    if (!g) return { ok: false, error: 'Open edition not found', nftIds: [] };
    if (g.Drop.approvedAt || g.contractAddress)
      return { ok: false, error: 'Drop is already approved/deployed — draft edits only', nftIds: [] };
    return { ok: true, nftIds: [g.nftId] };
  }
  return { ok: false, error: 'Unknown game type', nftIds: [] };
}

/**
 * Edits a DRAFT artwork's DB-side fields (name/description on the Nft, sale
 * parameters on the game). Free — nothing touches Arweave; the uploaded media
 * and metadata stay exactly as paid for.
 */
async function updateDraftArtwork(data: any, response: NextApiResponse) {
  console.log(`updateDraftArtwork(${data.gameType}, ${data.gameId})`);
  try {
    const gameId = Number(data.gameId);
    const guard = await assertDraftGame(String(data.gameType), gameId);
    if (!guard.ok) {
      response.status(400).json({ error: guard.error });
      return;
    }
    if (data.name != null || data.description != null) {
      await prisma.nft.updateMany({
        where: { id: { in: guard.nftIds } },
        data: {
          ...(data.name != null ? { name: String(data.name) } : {}),
          ...(data.description != null ? { description: String(data.description) } : {}),
        },
      });
    }
    if (data.gameType === 'auction' && data.minPrice != null) {
      await prisma.auction.update({
        where: { id: gameId },
        data: { minimumPrice: String(data.minPrice) },
      });
    }
    if (data.gameType === 'lottery') {
      await prisma.lottery.update({
        where: { id: gameId },
        data: {
          ...(data.ticketCostTokens != null ? { costPerTicketTokens: toNumber(data.ticketCostTokens) } : {}),
          ...(data.ticketCostPoints != null ? { costPerTicketPoints: toNumber(data.ticketCostPoints) } : {}),
          ...(data.maxTickets != null ? { maxTickets: toNumber(data.maxTickets) } : {}),
          ...(data.maxTicketsPerUser != null ? { maxTicketsPerUser: toNumber(data.maxTicketsPerUser) } : {}),
        },
      });
    }
    if (data.gameType === 'openEdition') {
      await prisma.openEdition.update({
        where: { id: gameId },
        data: {
          ...(data.costTokens != null ? { costTokens: toNumber(data.costTokens) } : {}),
          ...(data.costPoints != null ? { costPoints: toNumber(data.costPoints) } : {}),
          ...(data.maxPerUser != null ? { maxPerUser: toNumber(data.maxPerUser) } : {}),
        },
      });
    }
    response.json({ updated: true });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

/**
 * Removes an artwork (game + its Nft rows) from a DRAFT drop. The Arweave
 * upload is permanent and already paid for — deleting here only unlinks it
 * from the drop; re-adding the same piece later means paying again, so the
 * UI warns before calling this.
 */
async function deleteDraftArtwork(data: any, response: NextApiResponse) {
  console.log(`deleteDraftArtwork(${data.gameType}, ${data.gameId})`);
  try {
    const gameId = Number(data.gameId);
    const gameType = String(data.gameType);
    const guard = await assertDraftGame(gameType, gameId);
    if (!guard.ok) {
      response.status(400).json({ error: guard.error });
      return;
    }
    // game row first (it references the Nft), then the Nft rows
    if (gameType === 'auction') await prisma.auction.delete({ where: { id: gameId } });
    if (gameType === 'lottery') await prisma.lottery.delete({ where: { id: gameId } });
    if (gameType === 'openEdition') await prisma.openEdition.delete({ where: { id: gameId } });
    await prisma.nft.deleteMany({ where: { id: { in: guard.nftIds } } });
    response.json({ deleted: true });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

async function insertCollectionMint(data: any, response: NextApiResponse) {
  console.log('insertCollectionMint()');
  try {
    const record = await prisma.collectionMint.create({
      data: {
        dropId: Number(data.dropId),
        costTokens: toNumber(data.costTokens),
        // default ONE mint per wallet when unspecified; an explicit 0 is the
        // admin deliberately choosing unlimited
        limitPerUser: data.limitPerUser != null ? toNumber(data.limitPerUser) : 1,
        // maxSupply = image count, known only after the zip is processed
        maxSupply: 0,
        startTime: new Date(Number(data.startDate) * 1000),
        // null endDate = NO deadline: the mint stays open until sold out
        endTime: data.endDate ? new Date(Number(data.endDate) * 1000) : null,
        status: 'staging',
      },
    });
    response.json({ collectionMintId: record.id });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

/**
 * The long-running half of a collection drop: pulls the staged zip from S3,
 * bundles every image + generated metadata to Arweave (ANS-104), posts the
 * path manifest, mirrors everything to S3, and records the result. The
 * request stays open for the duration (Cloud Run --timeout raised for this);
 * progress is written to the CollectionMint row so the dashboard can poll
 * GetCollectionStatus in parallel. Idempotent: checkpoints in `progress`
 * mean a retry skips already-posted bundles.
 */
async function processCollectionZipAction(collectionMintId: number, response: NextApiResponse) {
  console.log(`processCollectionZip(${collectionMintId})`);
  const cm = await prisma.collectionMint.findUnique({
    where: { id: collectionMintId },
    include: { Drop: true },
  });
  if (!cm) {
    response.status(404).json({ error: 'Collection not found' });
    return;
  }
  if (cm.status === 'done') {
    response.json({ status: 'done', manifestId: cm.manifestId });
    return;
  }
  const zipUrl = `https://${process.env.S3_BUCKET}.s3.us-east-2.amazonaws.com/collection-staging/${collectionMintId}.zip`;
  try {
    // Pre-flight: this run spends real AR from the platform wallet — refuse
    // outright if the balance can't plausibly cover the zip's byte size.
    const headRes = await fetch(zipUrl, { method: 'HEAD' });
    if (!headRes.ok) {
      response.status(400).json({ error: `staged zip not found (HTTP ${headRes.status}) — upload it first` });
      return;
    }
    const zipBytes = Number(headRes.headers.get('content-length') || 0);
    const [estimate, { balance }] = await Promise.all([
      estimateUploadCostAR(zipBytes),
      getArweaveBalance(),
    ]);
    if (parseFloat(balance) < parseFloat(estimate)) {
      await prisma.collectionMint.update({
        where: { id: collectionMintId },
        data: { status: 'failed', progress: JSON.stringify({ error: `insufficient AR: need ~${estimate}, have ${balance}` }) },
      });
      response.status(400).json({ error: `Insufficient AR balance: this zip needs ~${estimate} AR, wallet has ${balance} AR` });
      return;
    }

    // resume data from a previous interrupted run
    const prior = cm.progress ? JSON.parse(cm.progress) : {};
    const priorCheckpoints: BatchCheckpoint[] = prior.checkpoints || [];
    const checkpoints: BatchCheckpoint[] = [...priorCheckpoints];

    await prisma.collectionMint.update({
      where: { id: collectionMintId },
      data: { status: 'processing' },
    });

    const result = await processCollectionZip({
      zipUrl,
      dropName: cm.Drop.name,
      description: cm.Drop.description,
      priorCheckpoints,
      onCheckpoint: async (cp) => {
        checkpoints.push(cp);
        await prisma.collectionMint.update({
          where: { id: collectionMintId },
          data: { progress: JSON.stringify({ checkpoints }) },
        });
      },
      onProgress: async (p: CollectionProgress) => {
        await prisma.collectionMint.update({
          where: { id: collectionMintId },
          data: {
            progress: JSON.stringify({
              imagesTotal: p.imagesTotal,
              imagesBundled: p.imagesBundled,
              bundlesPosted: p.bundlesPosted,
              checkpoints,
            }),
          },
        });
      },
    });

    await prisma.collectionMint.update({
      where: { id: collectionMintId },
      data: {
        status: 'done',
        manifestId: result.manifestId,
        baseUri: result.baseUri,
        maxSupply: result.maxSupply,
        previewImagePath: result.previewImagePath,
        pathMap: JSON.stringify(result.pathMap),
      },
    });
    response.json({ status: 'done', manifestId: result.manifestId, maxSupply: result.maxSupply });
  } catch (e: any) {
    console.log('processCollectionZip failed:', e);
    await prisma.collectionMint
      .update({
        where: { id: collectionMintId },
        data: {
          status: 'failed',
          progress: JSON.stringify({
            ...(cm.progress ? JSON.parse(cm.progress) : {}),
            error: e.message,
          }),
        },
      })
      .catch(() => {});
    response.status(500).json({ error: e.message });
  }
}

async function getCollectionStatus(collectionMintId: number, response: NextApiResponse) {
  const cm = await prisma.collectionMint.findUnique({
    where: { id: collectionMintId },
    select: { status: true, progress: true, maxSupply: true, manifestId: true, previewImagePath: true },
  });
  if (!cm) {
    response.status(404).json({ error: 'Collection not found' });
    return;
  }
  response.json(cm);
}

/**
 * Collection-mint bookkeeping, cloned from registerOpenEditionMint: mints
 * happen entirely on-chain, so this is how a collector's token becomes an Nft
 * row (visible in their Collection page). Verifies on-chain ownership AND that
 * the token's URI really is this collection's `{baseUri}{index}.json` before
 * writing — both tokenId and index are client-supplied.
 */
async function registerCollectionMint(
  data: { collectionMintId: number; tokenId: number; index: number },
  requester: Requester,
  response: NextApiResponse
) {
  console.log(
    `registerCollectionMint(${data.collectionMintId}, token ${data.tokenId}, index ${data.index}, ${requester.walletAddress})`
  );
  try {
    const cm = await prisma.collectionMint.findUnique({
      where: { id: Number(data.collectionMintId) },
      include: { Drop: { include: { NftContract: true } } },
    });
    if (!cm || !cm.baseUri || !cm.pathMap) {
      response.status(404).json({ error: 'Collection not found or not processed' });
      return;
    }
    const nftContractAddress = cm.Drop.NftContract.contractAddress;
    if (!nftContractAddress) {
      response.status(400).json({ error: 'Artist NFT contract not deployed yet' });
      return;
    }
    const tokenId = Number(data.tokenId);
    const index = Number(data.index);
    const provider = new ethers.providers.StaticJsonRpcProvider(
      parameters.RPC_URL,
      +parameters.CHAIN_ID
    );
    const nftContract = new ethers.Contract(
      nftContractAddress,
      [
        'function ownerOf(uint256) view returns (address)',
        'function tokenURI(uint256) view returns (string)',
      ],
      provider
    );
    const [onChainOwner, onChainUri] = await Promise.all([
      nftContract.ownerOf(tokenId),
      nftContract.tokenURI(tokenId),
    ]);
    if (onChainOwner.toLowerCase() !== requester.walletAddress.toLowerCase()) {
      response.status(403).json({ error: 'Token is not owned by the requesting wallet' });
      return;
    }
    if (onChainUri !== `${cm.baseUri}${index}.json`) {
      response.status(400).json({ error: 'Token URI does not match the claimed collection index' });
      return;
    }
    // sync cached mintCount from chain (idempotent, best-effort)
    if (cm.contractAddress) {
      try {
        const collectionContract = new ethers.Contract(
          cm.contractAddress,
          ['function getMintCount(uint256) view returns (uint32)'],
          provider
        );
        const mintCount = await collectionContract.getMintCount(cm.collectionId ?? cm.id);
        await prisma.collectionMint.update({
          where: { id: cm.id },
          data: { mintCount: Number(mintCount) },
        });
      } catch (e) {
        console.error(`Failed to sync mintCount for collection ${cm.id}`, e);
      }
    }
    // idempotent: a retried registration must not create a duplicate row
    const existing = await prisma.nft.findFirst({
      where: { tokenId, artistAddress: cm.Drop.artistAddress },
    });
    if (existing) {
      response.json({ nftId: existing.id });
      return;
    }
    const entry = JSON.parse(cm.pathMap)[String(index)];
    if (!entry) {
      response.status(400).json({ error: 'Unknown collection index' });
      return;
    }
    const imageUrl = `https://arweave.net/${entry.img}`;
    const record = await prisma.nft.create({
      data: {
        name: `${cm.Drop.name} #${index}`,
        description: cm.Drop.description,
        tokenId,
        metadataPath: `${cm.baseUri}${index}.json`,
        arweavePath: imageUrl,
        s3Path: imageUrl,
        s3PathOptimized: imageUrl,
        numberOfEditions: 1,
        ownerAddress: requester.walletAddress,
        artistAddress: cm.Drop.artistAddress,
        artistDisplayName: cm.Drop.artistDisplayName,
      },
    });
    response.json({ nftId: record.id });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

async function deleteNft(nftId: number, request: NextApiRequest, response: NextApiResponse) {
  console.log(`deleteNft(${nftId})`);
  const requester = await getRequester(request);
  const walletAddress = requester?.walletAddress;
  if (!walletAddress) {
    response.status(401).end('Not Authenticated');
    return;
  }
  await prisma.nft.deleteMany({
    where: {
      id: nftId,
      artistAddress: walletAddress as string,
      ownerAddress: undefined,
    },
  });
}

async function insertDrawing(data: any, response: NextApiResponse) {
  console.log('insertDrawing()');
  try {
    var record = await prisma.lottery.create({
      data: {
        dropId: Number(data.dropId),
        // null until on-chain createLottery runs — deployLotteries treats a
        // non-null contractAddress as "already deployed" and skips
        costPerTicketTokens: toNumber(data.ticketCostTokens),
        costPerTicketPoints: toNumber(data.ticketCostPoints),
        maxTickets: toNumber(data.maxTickets),
        maxTicketsPerUser: toNumber(data.maxTicketsPerUser),
        endTime: new Date(Number(data.endDate) * 1000),
        startTime: new Date(Number(data.startDate) * 1000),
        isRefundable: 'true' == data.isRefundable,
      },
    });
    response.json({ drawingId: record.id });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

const toNumber = (val: string): number => (val ? Number(val) : 0);

async function fetchFileContent(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  return new Uint8Array(await response.arrayBuffer());
}

function inferMimeType(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop();
  switch (extension) {
    case 'mp4':
      return 'video/mp4';
    case 'gif':
      return 'image/gif';
    case 'png':
      return 'image/png';
    case 'tiff':
      return 'image/tiff';
    case 'svg':
      return 'image/svg+xml';
  }
  return 'image/jpeg';
}

export default handler;
