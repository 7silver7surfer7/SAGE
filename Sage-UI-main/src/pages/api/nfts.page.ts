import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';
import { Nft, OfferState, User } from '@prisma/client';
import { getNFTContract } from '@/utilities/contracts';
import { ethers } from 'ethers';
import { getRequester } from '@/utilities/apiAuth';
import { CollectedListingNft, Nft_include_NftContractAndOffers } from '@/prisma/types';
import { SearchableNftData } from '@/store/nftsReducer';
import { sendArweaveTransaction } from '@/utilities/arweave-server';

export default async function handler(request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { action },
  } = request;
  switch (action) {
    case 'DeployContractMetadata':
      await deployContractMetadata(request, response);
      break;
    case 'GetSearchableNftData':
      await getSearchableNftData(response);
      break;
    case 'GetListingNftsByArtist':
      await getListingNftsByArtist(request.query.address as string, response);
      break;
    case 'GetListingNftsByOwner':
      await getListingNftsByOwner(request, response);
      break;
    case 'CreateOffer':
      await createOffer(request, response);
      break;
    case 'InvalidateOffer':
      await invalidateOffer(request, response);
      break;
    case 'DeleteOffer':
      await deleteOffer(request, response);
      break;
    case 'UpdateOwner':
      await updateOwner(request, Number(request.query.id), response);
      break;
    default:
      response.status(500);
  }
  response.end();
}

/**
 * https://docs.opensea.io/docs/contract-level-metadata
 */
async function deployContractMetadata(request: NextApiRequest, response: NextApiResponse) {
  console.log(`deployContractMetadata()`);
  const { artistAddress, contractAddress } = request.body;
  const artist = await prisma.user.findUnique({ where: { walletAddress: artistAddress } });
  if (!artist) {
    response.status(500).end();
    return;
  }
  const contractMetadata = {
    name: artist.username,
    description: artist.bio,
    image: artist.bannerImageS3Path,
    external_link: `${process.env.NEXTAUTH_URL}creators/${artist.username}`,
    seller_fee_basis_points: 1200,
    fee_recipient: contractAddress,
  };
  var metadataType = 'application/json';
  const { tx } = await sendArweaveTransaction(
    'contract-metadata.json',
    JSON.stringify(contractMetadata) as any,
    metadataType
  );
  const metadataURL = `https://arweave.net/${tx.id}`;
  response.json({ metadataURL });
}

async function getSearchableNftData(response: NextApiResponse) {
  console.log(`getSearchableNftData()`);
  try {
    const result = Array<SearchableNftData>();
    const nfts = await prisma.nft.findMany({
      where: { isHidden: false },
      distinct: ['s3PathOptimized'],
      include: {
        Auction: { include: { Drop: { include: { NftContract: { include: { Artist: true } } } } } },
        Lottery: { include: { Drop: { include: { NftContract: { include: { Artist: true } } } } } },
        NftContract: { include: { Artist: true } },
      },
    });
    for (const n of nfts) {
      if (n.Auction && !n.Auction.Drop.approvedAt) continue;
      if (n.Lottery && !n.Lottery.Drop.approvedAt) continue;
      result.push({
        name: n.name,
        width: n.width,
        height: n.height,
        s3PathOptimized: n.s3PathOptimized,
        artist:
          n.NftContract?.Artist.username! ||
          n.Auction?.Drop.NftContract.Artist.username! ||
          n.Lottery?.Drop.NftContract.Artist.username!,
        dId: n.Auction?.Drop.id || n.Lottery?.Drop.id || undefined,
        dName: n.Auction?.Drop.name || n.Lottery?.Drop.name || undefined,
      });
    }
    response.json(result);
  } catch (e) {
    console.log({ e });
    response.status(500);
  }
}

async function getListingNftsByArtist(artistAddress: string, response: NextApiResponse) {
  console.log(`getListingNftsByArtist(${artistAddress})`);
  try {
    const result = await prisma.nft.findMany({
      where: { artistAddress, isHidden: false },
      include: {
        NftContract: true,
        Offers: true,
      },
    });
    response.json(result as Nft_include_NftContractAndOffers[]);
  } catch (e) {
    console.log({ e });
    response.status(500);
  }
}

async function getListingNftsByOwner(request: NextApiRequest, response: NextApiResponse) {
  const requester = await getRequester(request);
  const ownerAddress = requester?.walletAddress;
  if (!ownerAddress) {
    response.status(401).end('Not Authenticated');
    return;
  }
  try {
    const nfts = new Array<CollectedListingNft>();
    const result = await prisma.nft.findMany({
      where: { ownerAddress, isHidden: false },
      include: { NftContract: { include: { Artist: true } } },
    });
    result.forEach((item) => nfts.push(flatten(item, item.NftContract?.Artist!)));
    response.json(nfts);
    console.log(`getListingNftsByOwner(${ownerAddress}) :: ${nfts.length}`);
  } catch (e) {
    console.log({ e });
    response.status(500);
  }
}

async function createOffer(request: NextApiRequest, response: NextApiResponse) {
  console.log(`createOffer()`);
  const requester = await getRequester(request);
  const address = requester?.walletAddress;
  if (!address) {
    response.status(401).end('Not Authenticated');
    return;
  }
  try {
    const { price, expiresAt, isSellOffer, signedOffer, nftContractAddress, nftId } = request.body;
    var record = await prisma.offer.create({
      data: {
        signer: address,
        price,
        expiresAt,
        isSellOffer,
        signedOffer,
        nftContractAddress,
        Nft: { connect: { id: +nftId } },
      },
    });
    response.json({ id: record.id });
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

async function deleteOffer(request: NextApiRequest, response: NextApiResponse) {
  const id = Number(request.query.id as string);
  const requester = await getRequester(request);
  const address = requester?.walletAddress;
  const state = OfferState.ACTIVE;
  if (!address) {
    response.status(401).end('Not Authenticated');
    return;
  }
  console.log(`deleteOffer(${id}, ${address})`);
  try {
    await prisma.offer.updateMany({
      where: { id, signer: address, state },
      data: { state: OfferState.CANCELLED },
    });
    response.status(200);
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

async function invalidateOffer(request: NextApiRequest, response: NextApiResponse) {
  const id = Number(request.query.id as string);
  const requester = await getRequester(request);
  const address = requester?.walletAddress;
  if (!address) {
    response.status(401).end('Not Authenticated');
    return;
  }
  console.log(`invalidateOffer(${id}, ${address})`);
  try {
    const offer = await prisma.offer.findUnique({ where: { id }, include: { Nft: true } });
    if (offer && offer.state == OfferState.ACTIVE && offer.Nft.artistAddress == address) {
      await prisma.offer.update({
        where: { id },
        data: { state: OfferState.INVALID },
      });
    }
    response.status(200);
  } catch (e: any) {
    console.log(e);
    response.json({ error: e.message });
  }
}

async function updateOwner(request: NextApiRequest, id: number, response: NextApiResponse) {
  console.log(`updateOwner(${id})`);
  // Previously unauthenticated — any caller could mark any ACTIVE offer USED
  // (griefing a legit offer). Require sign-in; the ownership check below ties
  // the update to a party actually involved in the trade.
  const requester = await getRequester(request);
  if (!requester) {
    response.status(401).end('Not Authenticated');
    return;
  }
  try {
    const offer = await prisma.offer.findUnique({
      where: { id },
      include: { Nft: { include: { NftContract: true } } },
    });
    if (!offer || offer.state != OfferState.ACTIVE) {
      throw new Error('Offer does not exist or is not active');
    }
    const nftContract = await getNFTContract(offer.nftContractAddress);
    const ownerAddress = await nftContract.ownerOf(offer.Nft.tokenId);
    console.log(
      `updateOwner() :: Owner of token ${offer.Nft.tokenId} on contract ${offer.nftContractAddress} is ${ownerAddress}`
    );
    if (ownerAddress == ethers.constants.AddressZero) {
      throw new Error('Token has no owner or was not found in contract');
    }
    // only the offer's signer or the token's (new) on-chain owner may finalize
    // this offer — reconciling DB state to a trade they were part of
    const caller = requester.walletAddress.toLowerCase();
    if (caller !== offer.signer.toLowerCase() && caller !== ownerAddress.toLowerCase()) {
      response.status(403).json({ error: 'Not a party to this offer' });
      return;
    }
    await prisma.offer.update({
      where: { id },
      data: { state: OfferState.USED },
    });
    await prisma.nft.update({
      where: { id: offer.nftId },
      data: { ownerAddress },
    });
    response.json(ownerAddress);
  } catch (e) {
    console.log({ e });
    response.status(500);
  }
}

function flatten(nft: Nft, artist: User): CollectedListingNft {
  return {
    nftId: nft.id,
    nftName: nft.name,
    artistUsername: nft.artistDisplayName || artist.username!,
    artistProfilePicture: artist.profilePicture!,
    s3Path: nft.s3Path,
    s3PathOptimized: nft.s3PathOptimized,
  };
}
