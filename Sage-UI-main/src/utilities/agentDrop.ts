import prisma from '@/prisma/client';
import { Role } from '@prisma/client';

/**
 * Create a DROP with one game on it — an open edition or an auction.
 *
 * WHY THIS EXISTS
 * ---------------
 * prepare_mint deploys a STANDALONE edition contract. That is fine for a 1/1
 * someone shares themselves, but it can never appear on sageart.xyz: the home
 * page selects Drops that are approved AND have a deployed game
 * (getHomePageData in prisma/functions), and a standalone edition has no Drop
 * at all. "Put it on the home page" therefore means the curated drop pipeline,
 * not a bigger prepare_mint.
 *
 * Open editions and auctions differ only in the game row. Both need the same
 * artist/contract rows, the same Drop, the same Nft, and the same on-chain
 * deploy afterwards — so this is written ONCE and switched at the end rather
 * than twice in parallel, which is how the two paths would drift.
 *
 * WHY NOT REUSE dropUpload's insertDrop/insertAuction/insertOpenEdition
 * --------------------------------------------------------------------
 * Those take FILE UPLOADS and store them. The agent's artwork is already
 * pinned to IPFS by the time a drop is asked for (pinImageAndMetadata runs at
 * generate/mint time), so there is nothing to upload — only rows to write
 * pointing at URIs that already exist. Everything downstream of these rows IS
 * the shared path: deployDrop() in dropsReducer runs unchanged.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It does not touch the chain, and it does not set `approvedAt`. The rows land
 * as an UNAPPROVED draft: nothing is public, nothing is minted, and the
 * artist's wallet still has to sign the deploy (deployDrop, which flips
 * approvedAt only after the games are actually on-chain). That ordering is the
 * safety property — an agent can assemble a drop from a sentence, but only a
 * human signature makes it real, and only a deployed game makes it visible.
 */

export type DropFormat = 'open-edition' | 'auction';

export interface AgentDropInput {
  format: DropFormat;
  /**
   * The artist's wallet — the drop is created FOR them and they sign it.
   * CALLERS MUST PASS THE AUTHENTICATED SESSION WALLET, never an address the
   * model produced: this address becomes the drop's owner (which is what the
   * self-serve deploy actions in drops.page.ts scope on) and receives the
   * artist share of every sale.
   */
  artistAddress: string;
  /** shown as the drop and artwork title */
  name: string;
  description?: string;
  /** permanent art, already pinned (see utilities/pinArt) */
  imageUri: string;
  /** permanent ERC-721 metadata — this is the on-chain tokenURI */
  tokenUri: string;
  /** how long the sale runs, in hours */
  durationHours: number;
  /**
   * Open edition: price per mint. Auction: the reserve. Denominated in the
   * drop's `currency` — the games parse it with parseEther either way, so ETH
   * and SAGE are both whole units here. 0 = a free mint / no reserve.
   */
  price?: number;
  currency?: 'ETH' | 'SAGE';
  /** open edition: 0 = unlimited per wallet, which is what "open" means */
  maxPerUser?: number;
  /** secondary-sale royalty, percent */
  royaltyPercent?: number;
  /** ERC-721 symbol, used only if this artist has no contract yet */
  symbol?: string;
}

export interface AgentDropResult {
  dropId: number;
  nftId: number;
  /** the OpenEdition or Auction row id */
  gameId: number;
  format: DropFormat;
  startTime: Date;
  endTime: Date;
}

/** Sanity bounds — an agent should not be able to open a decade-long sale. */
const MIN_HOURS = 1;
const MAX_HOURS = 24 * 30;
/** Mirrors insertDrop's server-side clamp, so both entry points agree. */
const MAX_ROYALTY = 20;

export async function createAgentDrop(input: AgentDropInput): Promise<AgentDropResult> {
  const artist = input.artistAddress;
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) throw new Error('a name is required');
  if (!/^ipfs:\/\/|^https:\/\//.test(input.tokenUri || '')) {
    throw new Error('the artwork must be pinned before a drop is created');
  }

  const hours = Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.round(input.durationHours || 24)));
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + hours * 3600 * 1000);
  const price = Math.max(0, Number(input.price) || 0);
  const currency = input.currency === 'SAGE' ? 'SAGE' : 'ETH';

  // The artist must exist as a User and own an NftContract row before a Drop
  // can connect to it. Both are upserts: a returning artist keeps their
  // profile and their existing contract, so a second drop never re-deploys
  // one (fetchOrCreateNftContract reuses it).
  await prisma.user.upsert({
    where: { walletAddress: artist },
    update: {},
    create: { walletAddress: artist, role: Role.ARTIST },
  });
  await prisma.nftContract.upsert({
    where: { artistAddress: artist },
    update: {},
    create: { artistAddress: artist },
  });

  const drop = await prisma.drop.create({
    data: {
      name,
      description: input.description || '',
      createdAt: startTime,
      // NOT approved and NOT staged: invisible on the storefront until the
      // deploy completes. The agent assembles; it does not publish.
      approvedAt: null,
      goLiveAt: null,
      // the pinned art doubles as the banner — there is no separate upload
      bannerImageS3Path: input.imageUri,
      tileImageS3Path: input.imageUri,
      // No explicit artistAddress: it IS the NftContract relation's foreign
      // key, and Prisma rejects setting the scalar and the relation together.
      nftSymbol:
        (input.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || null,
      royaltyPercentage: Math.min(MAX_ROYALTY, Math.max(0, Number(input.royaltyPercent) || 10)),
      currency,
      // Social-launcher economics (99/1) rather than the curated marketplace
      // split: this drop came from a creator through the agent, not from
      // curation, so it should not silently take the marketplace's cut. It is
      // also what dropDeployServer reads to stamp that rate.
      isSocial: true,
      NftContract: { connect: { artistAddress: artist } },
    },
  });

  // metadataPath is the ON-CHAIN tokenURI (dropDeployServer
  // pass it as nftUri); the image fields are what the site renders.
  const nft = {
    name,
    description: input.description || '',
    metadataPath: input.tokenUri,
    arweavePath: input.imageUri,
    s3Path: input.imageUri,
    s3PathOptimized: input.imageUri,
    mediaType: 'image',
  };

  if (input.format === 'auction') {
    const auction = await prisma.auction.create({
      data: {
        Drop: { connect: { id: drop.id } },
        // contractAddress stays NULL: dropDeployServer treats a non-null value
        // as "already deployed" and would skip this auction entirely.
        // minimumPrice is parseEther'd at deploy, so it must be a decimal
        // STRING and never null.
        minimumPrice: String(price),
        startTime,
        // The auction contract starts its clock at the FIRST BID; dropDeployServer
        // derives `duration` from these two, so the window is what encodes the
        // requested length.
        endTime,
        Nft: { create: { ...nft, numberOfEditions: 1 } },
      },
    });
    return {
      dropId: drop.id,
      nftId: auction.nftId,
      gameId: auction.id,
      format: 'auction',
      startTime,
      endTime,
    };
  }

  const oe = await prisma.openEdition.create({
    data: {
      Drop: { connect: { id: drop.id } },
      costTokens: price,
      costPoints: 0,
      // 0 means unlimited per wallet — the defining property of an OPEN
      // edition. A per-wallet cap here would quietly make it a limited one.
      maxPerUser: Math.max(0, Math.floor(Number(input.maxPerUser) || 0)),
      startTime,
      endTime,
      // unbounded supply, minted on demand — matches insertOpenEdition
      Nft: { create: { ...nft, numberOfEditions: 0 } },
    },
  });
  return {
    dropId: drop.id,
    nftId: oe.nftId,
    gameId: oe.id,
    format: 'open-edition',
    startTime,
    endTime,
  };
}
