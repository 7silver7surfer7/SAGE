import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { parameters, currencyAddressFor, isEthCurrency } from '@/constants/config';
import { getServerSigner, deployWhitelistServerSide } from '@/utilities/serverWallet';

/**
 * Create a drop's GAMES on-chain from the server, so the artist signs once.
 *
 * WHY THIS EXISTS
 * ---------------
 * Deploying a drop used to cost the artist four wallet signatures: deploy
 * their NFT contract, set its metadata, create the game, then set the game's
 * artist share. Only the FIRST is something only they can authorise — the
 * other three are the platform's own bookkeeping that merely happened to be
 * artist-callable, so the code made the artist sign them.
 *
 * The server key already holds `role.admin`, and every one of those calls
 * accepts an admin. Verified by callStatic on mainnet before this was written:
 *   deployByAdmin          -> allowed
 *   createOpenEdition      -> allowed
 *   setEditionArtistShare  -> allowed  (same role.admin gate)
 *   setContractMetadata    -> REFUSED  (needs DEFAULT_ADMIN, multisig only)
 *
 * So three of the four move here. setContractMetadata does not, and is
 * deliberately DROPPED from the deploy path rather than chased: it is the
 * collection-level URI external marketplaces read, nothing in SAGE blocks on
 * it, and drops.page.ts already treats it as "display-sugar — its failure must
 * not fail the deploy step". Granting the server DEFAULT_ADMIN to save one
 * signature on first drops only would widen a key that is already settlement,
 * oracle and admin at once.
 *
 * WHAT THE ARTIST STILL SIGNS: fetchOrCreateNftContract, and only when they
 * have no contract yet. Their first drop is one signature; every drop after it
 * is none.
 *
 * SCOPE: auctions and open editions — the two formats self-serve creators can
 * launch. Lotteries and ZIP collection mints stay on the client deploy path;
 * they are admin-only (the social launcher cannot create them) and carry their
 * own multi-step pipelines, so moving them is separate work rather than a
 * silent half-port.
 */

/** The 99/1 split social launches get instead of the marketplace default. */
const SOCIAL_ARTIST_SHARE_BPS = 9900;

export interface ServerDeployResult {
  auctions: number;
  openEditions: number;
  whitelist: string | null;
  txHashes: string[];
  /** games this path deliberately does not handle, if any are present */
  unsupported: string[];
}

/**
 * Everything the games need, read once. Kept narrow on purpose — this runs
 * with a key that can spend, so it should touch exactly what it needs.
 */
async function loadDrop(dropId: number) {
  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    include: {
      Auctions: { include: { Nft: true } },
      OpenEditions: { include: { Nft: true } },
      Lotteries: { select: { id: true } },
      CollectionMints: { select: { id: true } },
      NftContract: { select: { contractAddress: true } },
    },
  });
  if (!drop) throw new Error(`drop ${dropId} not found`);
  return drop;
}

export async function deployDropGamesServerSide(dropId: number): Promise<ServerDeployResult> {
  const drop = await loadDrop(dropId);
  const nftContract = drop.NftContract?.contractAddress;
  if (!nftContract) {
    // The one thing the artist signs. Without it there is nothing to mint INTO,
    // and the server deliberately does not deploy it on their behalf.
    throw new Error('the artist has no NFT contract yet — that step is signed by the artist');
  }

  const signer = getServerSigner();
  const txHashes: string[] = [];
  const unsupported: string[] = [];
  if (drop.Lotteries.length) unsupported.push(`${drop.Lotteries.length} lottery(ies)`);
  if (drop.CollectionMints.length) unsupported.push(`${drop.CollectionMints.length} collection mint(s)`);

  /**
   * Gated drops need their SageWhitelist before the games, so the games can be
   * wired to it at creation. Ungated drops pass AddressZero, exactly as the
   * client path does. voucherGating skips it entirely — those games carry the
   * flag instead and mint against a signed voucher.
   */
  let whitelist = ethers.constants.AddressZero;
  const needsWhitelist =
    !drop.voucherGating && (drop.allowlistEnabled || drop.ipGateEnabled || drop.followGateEnabled);
  if (needsWhitelist) {
    whitelist = drop.whitelistContractAddress || (await deployWhitelistServerSide());
    if (!drop.whitelistContractAddress) {
      await prisma.drop.update({
        where: { id: dropId },
        data: { whitelistContractAddress: whitelist },
      });
    }
  }

  /**
   * THE DROP'S ROYALTY, stamped before any game so every token minted for it
   * carries the chosen figure.
   *
   * setDefaultRoyalty is onlyAdminOrMultisig, so a self-serve artist could
   * never set it. The client detected that and skipped with a note — correct,
   * but it meant every self-serve drop silently kept the contract default
   * (12%) instead of the percentage the artist picked. The server holds
   * role.admin, so here it actually applies.
   *
   * Best-effort: a LEGACY artist contract predates the setter entirely and has
   * a fixed pooled royalty. That is a real, known state, not a failure, and it
   * must not stop the drop.
   */
  const royaltyBps = Math.round((drop.royaltyPercentage ?? 12) * 100);
  try {
    const nft = new ethers.Contract(
      nftContract,
      ['function setDefaultRoyalty(uint96)', 'function defaultRoyaltyBps() view returns (uint96)'],
      signer
    );
    const current = Number(await nft.defaultRoyaltyBps());
    if (current !== royaltyBps) {
      const tx = await nft.setDefaultRoyalty(royaltyBps);
      await tx.wait(1);
      txHashes.push(tx.hash);
    }
  } catch (e: any) {
    console.warn(`drop ${dropId}: royalty not applied (legacy contract?) — ${e?.message || e}`);
  }

  // ── auctions ──────────────────────────────────────────────────────────────
  const auctionAbi = [
    'function createAuction((uint256 auctionId,uint256 nftId,uint256 minimumPrice,uint256 startTime,uint256 endTime,uint256 duration,address nftContract,string nftUri,bool settled,uint256 highestBid,address highestBidder))',
    'function createAuctionWithCurrency((uint256 auctionId,uint256 nftId,uint256 minimumPrice,uint256 startTime,uint256 endTime,uint256 duration,address nftContract,string nftUri,bool settled,uint256 highestBid,address highestBidder),address)',
    'function setAuctionArtistShare(uint256,uint256)',
    'function getAuction(uint256) view returns (tuple(uint256 auctionId,uint256 nftId,uint256 minimumPrice,uint256 startTime,uint256 endTime,uint256 duration,address nftContract,string nftUri,bool settled,uint256 highestBid,address highestBidder))',
  ];
  const auctionContract = new ethers.Contract(parameters.AUCTION_ADDRESS, auctionAbi, signer);
  let auctionsMade = 0;
  for (const a of drop.Auctions) {
    // idempotent: a retry after a partial failure must not revert the whole run
    const existing = await auctionContract.getAuction(a.id).catch(() => null);
    if (existing && Number(existing.startTime) > 0) continue;
    const startTime = Math.floor(new Date(a.startTime).getTime() / 1000);
    const endTime = Math.floor(new Date(a.endTime ?? a.startTime).getTime() / 1000);
    const params = {
      auctionId: a.id,
      nftId: a.nftId,
      minimumPrice: ethers.utils.parseEther(a.minimumPrice || '0'),
      startTime,
      // the contract starts its clock at the FIRST BID (endTime 0 + duration)
      endTime: 0,
      duration: Math.max(endTime - startTime, 3600),
      nftContract,
      nftUri: a.Nft.metadataPath || '',
      settled: false,
      highestBid: 0,
      highestBidder: ethers.constants.AddressZero,
    };
    const tx = isEthCurrency(drop.currency)
      ? await auctionContract.createAuctionWithCurrency(params, currencyAddressFor('ETH'))
      : await auctionContract.createAuction(params);
    await tx.wait(1);
    txHashes.push(tx.hash);
    auctionsMade++;
    if (drop.isSocial) {
      // best-effort: the auction exists either way, and a missing share leaves
      // the marketplace default rather than a broken game
      try {
        const stx = await auctionContract.setAuctionArtistShare(a.id, SOCIAL_ARTIST_SHARE_BPS);
        await stx.wait(1);
        txHashes.push(stx.hash);
      } catch (e: any) {
        console.warn(`auction ${a.id}: social rate not applied — ${e?.message || e}`);
      }
    }
  }

  // ── open editions ─────────────────────────────────────────────────────────
  const oeAbi = [
    'function createOpenEdition((uint32 startTime,uint32 closeTime,uint32 costPoints,uint32 limitPerUser,uint32 mintCount,string nftUri,address nftContract,address whitelist,uint256 costTokens,uint256 id,address currency))',
    'function setEditionArtistShare(uint256,uint256)',
    'function getOpenEdition(uint256) view returns (tuple(uint32 startTime,uint32 closeTime,uint32 costPoints,uint32 limitPerUser,uint32 mintCount,string nftUri,address nftContract,address whitelist,uint256 costTokens,uint256 id,address currency))',
  ];
  const oeContract = new ethers.Contract(parameters.OPENEDITION_ADDRESS, oeAbi, signer);
  let editionsMade = 0;
  for (const oe of drop.OpenEditions) {
    const existing = await oeContract.getOpenEdition(oe.id).catch(() => null);
    if (existing && Number(existing.startTime) > 0) continue;
    const tx = await oeContract.createOpenEdition({
      startTime: Math.floor(new Date(oe.startTime).getTime() / 1000),
      closeTime: Math.floor(new Date(oe.endTime).getTime() / 1000),
      costPoints: oe.costPoints,
      limitPerUser: oe.maxPerUser,
      mintCount: 0,
      nftUri: oe.Nft.metadataPath || '',
      nftContract,
      whitelist,
      costTokens: ethers.utils.parseEther(String(oe.costTokens ?? 0)),
      id: oe.id,
      currency: currencyAddressFor(drop.currency),
    });
    await tx.wait(1);
    txHashes.push(tx.hash);
    editionsMade++;
    if (drop.isSocial) {
      try {
        const stx = await oeContract.setEditionArtistShare(oe.id, SOCIAL_ARTIST_SHARE_BPS);
        await stx.wait(1);
        txHashes.push(stx.hash);
      } catch (e: any) {
        console.warn(`edition ${oe.id}: social rate not applied — ${e?.message || e}`);
      }
    }
  }

  return {
    auctions: auctionsMade,
    openEditions: editionsMade,
    whitelist: whitelist === ethers.constants.AddressZero ? null : whitelist,
    txHashes,
    unsupported,
  };
}
