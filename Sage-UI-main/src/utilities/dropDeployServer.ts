import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { parameters, currencyAddressFor, isEthCurrency } from '@/constants/config';
import { getServerSigner, deployWhitelistServerSide } from '@/utilities/serverWallet';
import { publishMessage, PUBLISH_WINDOW_MS } from '@/constants/publish';
/**
 * THE REAL ABIs, from the build artifacts — never hand-written.
 *
 * The first version of this file spelled the auction tuple out by reading the
 * CLIENT'S OBJECT LITERAL and guessing the signature from it. That produced a
 * struct with 11 fields in the wrong order, uint256 where the contract uses
 * uint32, and an invented `nftId` the contract does not have. ethers encodes
 * strictly by ABI order, so every call was garbage calldata and reverted as
 * "cannot estimate gas" — a message that says nothing about the real cause.
 *
 * An object literal shows the FIELD NAMES a caller happened to pass. It does
 * not show order, width, or whether a field exists. Only the artifact does.
 */
import AuctionJson from '@/constants/abis/Auction/Auction.sol/Auction.json';
import OpenEditionJson from '@/constants/abis/OpenEdition/SAGEOpenEdition.sol/SAGEOpenEdition.json';

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

/**
 * Prove the DROP'S OWNER asked for this, before spending the platform's gas.
 *
 * Moving the deploy server-side removed every wallet prompt after an artist's
 * first drop, which took away the one thing tying a human to the act of
 * publishing — and left a path where anyone able to create a drop could make
 * the platform spend gas by calling an endpoint. One signature restores both:
 * it is the artist's authorisation AND the spend guard.
 *
 * Off-chain deliberately. An on-chain transaction would prove the same thing
 * while costing the artist gas and a confirmation wait, for a step whose only
 * job is to say "yes, publish it".
 */
export function verifyPublishSignature(
  dropId: number,
  artistAddress: string,
  issuedAt: string,
  signature: string
): void {
  const at = Date.parse(issuedAt);
  if (!Number.isFinite(at)) throw new Error('publish signature has no valid timestamp');
  if (Math.abs(Date.now() - at) > PUBLISH_WINDOW_MS) {
    throw new Error('publish signature has expired — sign again');
  }
  let recovered: string;
  try {
    recovered = ethers.utils.verifyMessage(publishMessage(dropId, issuedAt), signature);
  } catch {
    throw new Error('publish signature could not be read');
  }
  if (recovered.toLowerCase() !== artistAddress.toLowerCase()) {
    throw new Error('publish signature is not from this drop\'s artist');
  }
}

export async function deployDropGamesServerSide(
  dropId: number,
  auth: { issuedAt: string; signature: string }
): Promise<ServerDeployResult> {
  const drop = await loadDrop(dropId);
  // BEFORE any gas is spent, and before the artist contract check, so a
  // forged request cannot even probe.
  verifyPublishSignature(dropId, drop.artistAddress, auth.issuedAt, auth.signature);
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
  const auctionContract = new ethers.Contract(parameters.AUCTION_ADDRESS, AuctionJson.abi, signer);
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
    // same reasoning as editionId below: the client path stamped this via
    // UpdateAuctionContractAddress, so the server path must too
    await prisma.auction.update({
      where: { id: a.id },
      data: { contractAddress: parameters.AUCTION_ADDRESS },
    });
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
  const oeContract = new ethers.Contract(parameters.OPENEDITION_ADDRESS, OpenEditionJson.abi, signer);
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
    /**
     * editionId IS THE MINT GATE. The client path wrote it via
     * UpdateOpenEditionContractAddress and I did not port that when this moved
     * server-side — I assumed marking the drop live was enough, because that
     * sets contractAddress and isLive. It does not set editionId.
     *
     * MintOpenEditionModal gates on
     *   Boolean(parameters.OPENEDITION_ADDRESS && openEdition.editionId != null)
     * so a null here refuses every mint with "on-chain minting opens once the
     * SAGE contracts are live" — a message about contracts, for a row that was
     * missing one integer. The drop deploys, goes live, looks perfect, and
     * cannot be minted.
     *
     * The on-chain struct id IS this row's DB id, which is why it can simply
     * be copied.
     */
    await prisma.openEdition.update({
      where: { id: oe.id },
      data: { editionId: oe.id, contractAddress: parameters.OPENEDITION_ADDRESS },
    });
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
