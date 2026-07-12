import { BigNumber, ContractTransaction, ethers, Signer } from 'ethers';
import {
  approveERC20Transfer,
  extractErrorMessage,
  getMarketplaceContract,
  getNFTContract,
  getNftFactoryContract,
  getStorageContract,
} from '@/utilities/contracts';
import { createNftMetadataOnArweave, uploadFileToArweave } from '@/utilities/arweave-client';
import { CollectedListingNft, Nft_include_NftContractAndOffers, Nft } from '@/prisma/types';
import { toast } from 'react-toastify';
import { Offer } from '@prisma/client';
import { baseApi } from './baseReducer';
import { promiseToast } from '@/utilities/toast';
import { registerMarketplaceSale } from '@/utilities/sales';
import { parameters, currencyAddressFor } from '@/constants/config';
import { NFTFactory } from '@/types/contracts';
import { name } from 'aws-sdk/clients/importexport';

export interface MintRequest {
  name: string;
  description: string;
  //tags: string;
  price: number;
  isFixedPrice: boolean;
  file: File;
  width: number;
  height: number;
  s3Path: string | null;
  s3PathOptimized: string | null;
  signer: Signer;
}

export interface OfferRequest {
  nftId: number;
  tokenId: number;
  nftContractAddress: string;
  amount: number;
  signer: Signer;
  signedOffer?: string;
  expiresAt?: Date;
}

export interface SearchableNftData
  extends Pick<Nft, 'name' | 's3PathOptimized' | 'width' | 'height'> {
  artist: string; // username
  dId?: number; // dropId
  dName?: string; // dropName
}

const { CHAIN_ID } = parameters;

export const nftsApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    getSearchableNftData: builder.query<SearchableNftData[], void>({
      query: () => `nfts?action=GetSearchableNftData`,
    }),
    getListingNftsByArtist: builder.query<Nft_include_NftContractAndOffers[], string>({
      query: (artistAddress) => `nfts?action=GetListingNftsByArtist&address=${artistAddress}`,
      providesTags: ['Nfts'],
    }),
    getListingNftsByOwner: builder.query<CollectedListingNft[], void>({
      query: () => `nfts?action=GetListingNftsByOwner`,
      providesTags: ['Nfts'],
    }),
    mintSingleNft: builder.mutation<number, MintRequest>({
      queryFn: async (mintRequest, {}, _, fetchWithBQ) => {
        var nftId = 0;
        try {
          const endpoint = '/api/endpoints/dropUpload/';
          const artistAddress = await mintRequest.signer.getAddress();
          const nftContractAddress = await fetchOrCreateNftContract(
            artistAddress,
            mintRequest.signer,
            fetchWithBQ
          );
          const { mediaPath, optimizedPath, metadataPath } = await uploadToArweave(
            mintRequest,
            endpoint
          );
          const nftContract = await getNFTContract(nftContractAddress, mintRequest.signer);
          const tokenId = await nftContract.nextTokenId();
          console.log(`mintSingleNft() :: Token ID = ${tokenId}...`);
          nftId = await dbInsertNft(
            { ...mintRequest, s3PathOptimized: optimizedPath },
            tokenId.toNumber(),
            artistAddress,
            mediaPath,
            mediaPath,
            metadataPath,
            fetchWithBQ
          );
          console.log(`mintSingleNft() :: Minting on NFT Contract ${nftContractAddress}...`);
          const mintTx = await nftContract.artistMint(metadataPath);
          await mintTx.wait();
          if (mintRequest.isFixedPrice) {
            await createSignedOffer(
              nftContractAddress,
              nftId,
              tokenId.toNumber(),
              mintRequest.price,
              mintRequest.signer,
              true,
              fetchWithBQ
            );
          }
          return { data: nftId };
        } catch (e) {
          console.log(e);
          if (nftId && nftId != 0) {
            console.log(`mintSingleNft() :: Deleting NFT...`);
            await fetchWithBQ(`endpoints/dropUpload?action=DeleteNft&id=${nftId}`);
          }
          return { data: 0 };
        }
      },
      invalidatesTags: ['Nfts'],
    }),
    buyFromSellOffer: builder.mutation<boolean, { tokenId: number; offer: Offer; signer: Signer }>({
      queryFn: async ({ tokenId, offer, signer }, {}, _, fetchWithBQ) => {
        const marketplaceContract = await getMarketplaceContract(signer);
        const weiPrice = ethers.utils.parseEther(offer.price.toString());
        // the currency is baked into the SIGNED offer — replay it exactly
        const offerCurrency = (offer as any).currency || 'SAGE';
        const isEthListing = offerCurrency === 'ETH';
        if (!isEthListing) {
          try {
            const tokenAddress = await marketplaceContract.token();
            await approveERC20Transfer(tokenAddress, marketplaceContract.address, weiPrice, signer);
          } catch (e) {
            console.error(e);
            toast.error(`Error approving transfer`);
            return { data: false };
          }
        }
        try {
          console.log(
            `buyFromSellOffer(${offer.signer}, ${offer.nftContractAddress}, ${weiPrice}, ${tokenId}, ${offer.expiresAt}, ${offerCurrency}, ${offer.signedOffer})`
          );
          const tx = await marketplaceContract.buyFromSellOffer(
            offer.signer,
            offer.nftContractAddress,
            weiPrice,
            tokenId,
            offer.expiresAt,
            CHAIN_ID,
            currencyAddressFor(offerCurrency),
            offer.signedOffer,
            isEthListing ? { value: weiPrice } : {}
          );
          promiseToast(tx, `You've bought an NFT!`);
          await tx.wait(1);
          await fetchWithBQ(`nfts?action=UpdateOwner&id=${offer.id}`);
          await registerMarketplaceSale(
            offer.nftId,
            offer.price,
            await signer.getAddress(),
            tx,
            signer
          );
          return { data: true };
        } catch (e) {
          console.log(e);
          toast.error('Error buying NFT');
          return { data: false };
        }
      },
      invalidatesTags: ['Nfts'],
    }),
    sellFromBuyOffer: builder.mutation<boolean, { tokenId: number; offer: Offer; signer: Signer }>({
      queryFn: async ({ tokenId, offer, signer }, {}, _, fetchWithBQ) => {
        const marketplaceContract = await getMarketplaceContract(signer);
        const weiPrice = ethers.utils.parseEther(offer.price.toString());
        try {
          console.log(
            `sellFromBuyOffer(${offer.signer}, ${offer.nftContractAddress}, ${weiPrice}, ${tokenId}, ${offer.expiresAt}, ${CHAIN_ID}, ${offer.signedOffer})`
          );
          // buy offers are SAGE-only (a seller-executed call can't carry the
          // buyer's ETH), so the currency here is always the SAGE sentinel
          const tx = await marketplaceContract.sellFromBuyOffer(
            offer.signer,
            offer.nftContractAddress,
            weiPrice,
            tokenId,
            offer.expiresAt,
            CHAIN_ID,
            currencyAddressFor((offer as any).currency || 'SAGE'),
            offer.signedOffer
          );
          promiseToast(tx, `You've sold an NFT!`);
          await tx.wait(1);
          await fetchWithBQ(`nfts?action=UpdateOwner&id=${offer.id}`);
          await registerMarketplaceSale(offer.nftId, offer.price, offer.signer, tx, signer);
          return { data: true };
        } catch (e) {
          console.log(e);
          const errMsg = extractErrorMessage(e);
          if (errMsg.includes('transfer amount exceeds balance')) {
            await fetchWithBQ(`nfts?action=InvalidateOffer&id=${offer.id}`);
          }
          toast.error(`Failure! ${errMsg}`);
          return { data: false };
        }
      },
      invalidatesTags: ['Nfts'],
    }),
    createBuyOffer: builder.mutation<null, OfferRequest>({
      queryFn: async (offer, {}, _, fetchWithBQ) => {
        try {
          const weiAmount = ethers.utils.parseEther(offer.amount.toString());
          const marketplaceContract = await getMarketplaceContract(offer.signer);
          const tokenAddress = await marketplaceContract.token();
          await approveERC20Transfer(
            tokenAddress,
            marketplaceContract.address,
            weiAmount,
            offer.signer
          );
          await createSignedOffer(
            offer.nftContractAddress,
            offer.nftId,
            offer.tokenId,
            offer.amount,
            offer.signer,
            false,
            fetchWithBQ
          );
          toast.success(
            `Success! You've placed an offer of ${offer.amount} SAGE. We'll let you know if the artist accepts it!`
          );
        } catch (e) {
          console.error(e);
          toast.error(`Error placing offer`);
        }
        return { data: null };
      },
      invalidatesTags: ['Nfts'],
    }),
    deleteBuyOffer: builder.mutation<null, number>({
      query: (offerId) => `nfts?action=DeleteOffer&id=${offerId}`,
      invalidatesTags: ['Nfts'],
    }),
  }),
});

async function uploadToArweave(mintRequest: MintRequest, endpoint: string) {
  // Media is uploaded straight to Arweave (the sole media host). TIFF previews
  // are pre-uploaded by FileInputWithPreview, so reuse those URLs if present.
  let mediaPath: string;
  let optimizedPath: string;
  if (mintRequest.s3Path) {
    console.log(`uploadToArweave() :: Media already uploaded to Arweave`);
    mediaPath = mintRequest.s3Path;
    optimizedPath = mintRequest.s3PathOptimized || mintRequest.s3Path;
  } else {
    console.log(`uploadToArweave() :: Uploading media to Arweave...`);
    const { url, optimizedUrl } = await uploadFileToArweave(mintRequest.file);
    mediaPath = url;
    optimizedPath = optimizedUrl;
  }
  console.log(`uploadToArweave() :: Uploading metadata to Arweave...`);
  const metadataPath = await createNftMetadataOnArweave(
    endpoint,
    mintRequest.name,
    mintRequest.description,
    mediaPath,
    mintRequest.file.name.toLowerCase().endsWith('mp4')
  );
  return { mediaPath, optimizedPath, metadataPath };
}

async function dbInsertNft(
  mintRequest: MintRequest,
  tokenId: number,
  artistAddress: string,
  s3Path: string,
  arweavePath: string,
  metadataPath: string,
  fetchWithBQ: any
) {
  console.log(`dbInsertNft() :: Creating database record...`);
  const { data } = await fetchWithBQ({
    url: `endpoints/dropUpload?action=InsertNft`,
    method: 'POST',
    body: {
      artistAddress,
      tokenId,
      name: mintRequest.name,
      description: mintRequest.description,
      //tags: mintRequest.tags,
      price: mintRequest.price,
      width: mintRequest.width,
      height: mintRequest.height,
      s3Path,
      s3PathOptimized: mintRequest.s3PathOptimized,
      metadataPath,
      arweavePath,
      numberOfEditions: 1,
    },
  });
  const nftId = (data as any).nftId;
  if (!nftId || nftId == 0) {
    throw new Error('Failed inserting NFT into database');
  }
  console.log(`dbInsertNft() :: Database NFT ID = ${nftId}`);
  return nftId;
}

async function createSignedOffer(
  nftContractAddress: string,
  nftId: number,
  tokenId: number,
  amount: number,
  signer: Signer,
  isSellOffer: boolean,
  fetchWithBQ: any,
  currency: 'SAGE' | 'ETH' = 'SAGE'
) {
  const weiAmount = ethers.utils.parseEther(amount.toString());
  var { signedOffer, expiresAt } = await signOffer(
    nftContractAddress,
    tokenId,
    weiAmount,
    signer,
    isSellOffer,
    currency
  );
  const { data } = await fetchWithBQ({
    url: `nfts?action=CreateOffer`,
    method: 'POST',
    body: {
      signer: await signer.getAddress(),
      nftContractAddress,
      price: amount,
      nftId,
      expiresAt,
      signedOffer,
      isSellOffer,
      currency,
    },
  });
  const id = parseInt((data as any).id);
  if (isNaN(id)) {
    throw new Error('Failed inserting offer into database');
  }
  console.log(`createSignedOffer() :: Database Offer ID = ${id}`);
}

async function signOffer(
  nftContractAddress: string,
  nftId: number,
  weiPrice: BigNumber,
  signer: Signer,
  isSellOffer: boolean,
  currency: 'SAGE' | 'ETH' = 'SAGE'
): Promise<{ signedOffer: string; expiresAt: number }> {
  const oneWeekFromNow = new Date();
  oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
  const expiresAt = Math.floor(oneWeekFromNow.getTime() / 1000);
  const signerAddress = await signer.getAddress();
  // the currency address is part of the signed payload (marketplace contract
  // verifies it), so a SAGE-signed listing can never execute as ETH or vice versa
  const message = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'address', 'bool'],
    [
      signerAddress,
      nftContractAddress,
      weiPrice,
      nftId,
      expiresAt,
      CHAIN_ID,
      currencyAddressFor(currency),
      isSellOffer,
    ]
  );
  const encodedMessage = ethers.utils.keccak256(message);
  const signedOffer = await signer.signMessage(ethers.utils.arrayify(encodedMessage));
  console.log(
    `signOffer(${signerAddress}, ${nftContractAddress}, ${weiPrice}, ${nftId}, ${expiresAt}, ${CHAIN_ID}, ${currency}, ${isSellOffer}) :: ${signedOffer}`
  );
  return { signedOffer, expiresAt };
}

export async function fetchOrCreateNftContract(
  artistAddress: string,
  signer: Signer,
  fetchWithBQ: any
): Promise<string> {
  // check db for existing nft contract
  const { data } = await fetchWithBQ(`drops?action=GetNftContractAddress&address=${artistAddress}`);
  if (data.contractAddress) {
    console.log(
      `fetchOrCreateNftContract() :: Found existing NFT contract in database at ${data.contractAddress}`
    );
    return data.contractAddress;
  }
  // check contract factory for existing nft contract
  const nftFactoryContract = await getNftFactoryContract(signer);
  console.log(`fetchOrCreateNftContract() :: Using Factory ${nftFactoryContract.address}`);
  var artistContractAddress = await nftFactoryContract.getContractAddress(artistAddress);
  if (!artistContractAddress || artistContractAddress == ethers.constants.AddressZero) {
    console.log(`fetchOrCreateNftContract() :: Creating new NFT contract...`);
    artistContractAddress = await createNftContract(
      nftFactoryContract,
      signer,
      artistAddress,
      fetchWithBQ
    );
  }
  // update db
  await fetchWithBQ(
    `drops?action=UpdateNftContractAddress&artistAddress=${artistAddress}&contractAddress=${artistContractAddress}`
  );
  console.log(`fetchOrCreateNftContract() :: Contract deployed to ${artistContractAddress}`);
  return artistContractAddress;
}

async function createNftContract(
  factory: NFTFactory,
  signer: Signer,
  artistAddress: string,
  fetchWithBQ: any
): Promise<string> {
  var tx: ContractTransaction;
  // Pick the deploy path by the roles the signer actually holds on-chain,
  // not by self-vs-other: deployByArtist requires role.artist and reverts at
  // gas estimation otherwise (error with no wallet prompt). An admin deploying
  // a contract for their own wallet must go through deployByAdmin.
  const signerAddress = await signer.getAddress();
  const storageContract = await getStorageContract(signer);
  const artistRole = ethers.utils.id('role.artist');
  const adminRole = ethers.utils.id('role.admin');
  const isSelf = artistAddress.toLowerCase() == signerAddress.toLowerCase();
  if (isSelf && (await storageContract.hasRole(artistRole, signerAddress))) {
    console.log(`createNftContract() :: deployByArtist as ${signerAddress}`);
    tx = await factory.deployByArtist('SAGE', 'SAGE');
  } else if (await storageContract.hasRole(adminRole, signerAddress)) {
    console.log(`createNftContract() :: deployByAdmin for artist ${artistAddress}`);
    tx = await factory.deployByAdmin(artistAddress, 'SAGE', 'SAGE', 8333); // artist share is 83,33%
  } else {
    throw new Error(
      `Wallet ${signerAddress} holds neither role.artist nor role.admin on-chain, ` +
        'so it cannot deploy an NFT contract. Grant a role in SageStorage and retry.'
    );
  }
  await tx.wait(1);
  const contractAddress = await factory.getContractAddress(artistAddress);
  if (contractAddress == ethers.constants.AddressZero) {
    throw new Error('Unable to create a new NFT contract');
  }
  console.log(`createNftContract() :: Deploying contract metadata file...`);
  const { data: response } = await fetchWithBQ({
    url: `nfts?action=DeployContractMetadata`,
    method: 'POST',
    body: { artistAddress, contractAddress },
  });
  const metadataURL = (response as any).metadataURL;
  console.log(`createNftContract() :: Setting contract metadata to ${metadataURL}`);
  const contract = await getNFTContract(contractAddress, signer);
  tx = await contract.setContractMetadata(metadataURL);
  await tx.wait();
  return contractAddress;
}

export const {
  useGetSearchableNftDataQuery,
  useGetListingNftsByArtistQuery,
  useGetListingNftsByOwnerQuery,
  useMintSingleNftMutation,
  useBuyFromSellOfferMutation,
  useSellFromBuyOfferMutation,
  useCreateBuyOfferMutation,
  useDeleteBuyOfferMutation,
} = nftsApi;
