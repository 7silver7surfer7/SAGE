import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { parameters, currencyAddressFor, isEthCurrency } from '@/constants/config';
import { getServerSigner, deployWhitelistServerSide } from '@/utilities/serverWallet';
import { publishMessage, PUBLISH_WINDOW_MS } from '@/constants/publish';
import DedicatedNftDeployerJson from '@/constants/abis/NFT/DedicatedNftDeployer.sol/DedicatedNftDeployer.json';
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
import LotteryJson from '@/constants/abis/Lottery/Lottery.sol/Lottery.json';

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
  lotteries: number;
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
      Lotteries: { include: { Nfts: true } },
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
  const signer = getServerSigner();
  const txHashes: string[] = [];

  /**
   * EVERY DROP GETS ITS OWN CONTRACT, from here on.
   *
   * Artists used to share one SageNFT across all their drops, so external
   * marketplaces titled every collection with the artist's contract name and a
   * drop had no identity of its own. A fresh contract per drop makes each drop
   * its own collection, named after the drop.
   *
   * WHY A SEPARATE DEPLOYER AND NOT THE FACTORY: NFTFactory.createNFTContract
   * hard-requires `artistContracts[artist] == address(0)` — one per artist,
   * forever, so it can never mint a second. And no artifact in either repo
   * reproduces the factory's embedded SageNFT compilation: the Solidity repo's
   * runtime hashes to 0xc94c3015… and the UI repo's is a different length
   * again, while every genuine deployment is 0x2dadca49…. Deploying from
   * either would produce a contract the games REFUSE, because _isTrustedNft
   * compares runtime codehashes.
   *
   * DedicatedNftDeployer is the contract SageCollection already uses for
   * exactly this, and it carries its own SageNFT compilation — verified on
   * mainnet before this shipped: a contract deployed through it hashes to
   * 0x2dadca49…, matching trustedNftReference exactly.
   *
   * Existing drops keep their shared contract: nftContractAddress is null for
   * them, and their games hold the old address on-chain regardless.
   */
  let nftContract = drop.nftContractAddress;
  if (!nftContract) {
    if (!parameters.NFT_DEPLOYER_ADDRESS) {
      throw new Error('no dedicated NFT deployer configured for this environment');
    }
    const deployer = new ethers.Contract(
      parameters.NFT_DEPLOYER_ADDRESS,
      DedicatedNftDeployerJson.abi,
      signer
    );
    const symbol =
      (drop.nftSymbol || drop.name).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'SAGE';
    // The royalty goes in the CONSTRUCTOR. setDefaultRoyalty is
    // onlyAdminOrMultisig, which is why a self-serve artist's chosen
    // percentage never applied on the shared contract — here it is set at
    // birth, so it needs no follow-up transaction and cannot be skipped.
    const royaltyBps = Math.round((drop.royaltyPercentage ?? 12) * 100);
    const addr = await deployer.callStatic.deploy(
      drop.name.slice(0, 60), symbol, parameters.STORAGE_ADDRESS,
      drop.artistAddress, 8333, royaltyBps
    );
    const dtx = await deployer.deploy(
      drop.name.slice(0, 60), symbol, parameters.STORAGE_ADDRESS,
      drop.artistAddress, 8333, royaltyBps
    );
    await dtx.wait(1);
    txHashes.push(dtx.hash);
    nftContract = addr;
    await prisma.drop.update({ where: { id: dropId }, data: { nftContractAddress: addr } });
    console.log(`drop ${dropId} :: dedicated NFT contract ${addr} ("${drop.name}" / ${symbol})`);
  }

  const unsupported: string[] = [];
  // ZIP collections stay on the client path — not because they need the
  // artist's wallet, but because SageCollection.createCollectionWithNewNft
  // already deploys their per-drop contract itself, in the same transaction
  // that registers the collection. Moving it here would duplicate a deploy
  // that contract does better.
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
   * NO setDefaultRoyalty STEP. The per-drop contract takes its royalty in the
   * CONSTRUCTOR, so it is correct from birth. That also fixes the old silent
   * failure: setDefaultRoyalty is onlyAdminOrMultisig, so a self-serve artist
   * could never apply the percentage they chose and every self-serve drop
   * quietly kept the 12% default.
   */

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

  // ── lotteries ─────────────────────────────────────────────────────────────
  /**
   * Lotteries moved here for the same reason auctions and editions did, plus
   * one of their own: on the client path they were the last game still minting
   * into the artist's SHARED contract, whose ERC-721 name() is the artist's
   * display name and is immutable. Marketplaces title a collection by that
   * field, so a lottery drop called "Everyday No. 1" surfaced as whatever the
   * artist had once named their contract, alongside every other drop they had
   * ever made. Pointing nftContract at this drop's own contract is the whole
   * fix — and it needs no on-chain admin work, because SageNFT.safeMint checks
   * role.minter against the SHARED SageStorage rather than per contract, so a
   * contract deployed a moment ago already accepts the Lottery singleton.
   * Confirmed on mainnet: hasRole(role.minter, LOTTERY_ADDRESS) is true.
   */
  const lotteryContract = new ethers.Contract(parameters.LOTTERY_ADDRESS, LotteryJson.abi, signer);
  const isVoucher = !!drop.voucherGating;
  let lotteriesMade = 0;
  const toCreate: any[] = [];
  for (const l of drop.Lotteries) {
    // Idempotent like the games above: ask the chain, not the DB row, so a run
    // that created the lottery and then died before writing contractAddress
    // resumes instead of reverting on "lottery already exists".
    const existing = await lotteryContract.getLotteryInfo(l.id).catch(() => null);
    if (existing && Number(existing.startTime) > 0) continue;
    toCreate.push({
      startTime: Math.floor(new Date(l.startTime).getTime() / 1000),
      closeTime: Math.floor(new Date(l.endTime).getTime() / 1000),
      participantsCount: 0,
      maxTickets: l.maxTickets || 0,
      maxTicketsPerUser: l.maxTicketsPerUser || 0,
      numberOfTicketsSold: 0,
      numberOfEditions: l.Nfts[0]?.numberOfEditions ?? 1,
      status: 0, // Status.Created
      nftContract,
      lotteryID: l.id,
      ticketCostPoints: l.costPerTicketPoints,
      ticketCostTokens: ethers.utils.parseEther(String(l.costPerTicketTokens ?? 0)),
    });
  }
  if (toCreate.length) {
    if (isEthCurrency(drop.currency)) {
      // No batch variant of createLotteryWithCurrency exists, so ETH drops
      // stamp the native-currency sentinel one lottery at a time.
      for (const p of toCreate) {
        const tx = await lotteryContract.createLotteryWithCurrency(p, currencyAddressFor('ETH'));
        await tx.wait(1);
        txHashes.push(tx.hash);
      }
    } else {
      const tx = await lotteryContract.createLotteryBatch(toCreate);
      await tx.wait(1);
      txHashes.push(tx.hash);
    }
    lotteriesMade = toCreate.length;
    await prisma.lottery.updateMany({
      where: { id: { in: toCreate.map((p) => p.lotteryID) } },
      data: { contractAddress: parameters.LOTTERY_ADDRESS, voucherGated: isVoucher },
    });
  }

  /**
   * Gating is a separate pass on purpose: LotteryInfo carries no whitelist
   * field, so it cannot be set at creation the way the other games do it.
   * Iterating ALL of the drop's lotteries rather than only the freshly created
   * ones is what makes an interrupted run recoverable — the create loop above
   * skips lotteries that already exist on-chain, and those are exactly the ones
   * a previous run may have failed to gate.
   */
  if (isVoucher) {
    for (const l of drop.Lotteries) {
      if (await lotteryContract.voucherGated(l.id).catch(() => false)) continue;
      const tx = await lotteryContract.setVoucherGated(l.id, true);
      await tx.wait(1);
      txHashes.push(tx.hash);
    }
  } else if (whitelist !== ethers.constants.AddressZero) {
    for (const l of drop.Lotteries) {
      const current = await lotteryContract.getWhitelist(l.id).catch(() => null);
      if (current?.toLowerCase() === whitelist.toLowerCase()) continue;
      const tx = await lotteryContract.setWhitelist(l.id, whitelist);
      await tx.wait(1);
      txHashes.push(tx.hash);
    }
  }

  return {
    auctions: auctionsMade,
    openEditions: editionsMade,
    lotteries: lotteriesMade,
    whitelist: whitelist === ethers.constants.AddressZero ? null : whitelist,
    txHashes,
    unsupported,
  };
}
