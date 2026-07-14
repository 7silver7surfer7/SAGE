import { GamePrize } from '@/prisma/types';
import {
  approveERC20Transfer,
  extractErrorMessage,
  getAuctionContract,
} from '@/utilities/contracts';
import { toast } from 'react-toastify';
import { Auction_include_Nft } from '@/prisma/types';
import { BigNumber, ethers, Signer, utils } from 'ethers';
import { baseApi } from './baseReducer';
import { promiseToast } from '@/utilities/toast';
import { registerAuctionSale } from '@/utilities/sales';
import { parameters, NATIVE_CURRENCY_SENTINEL } from '@/constants/config';

export interface AuctionState {
  highestBidder: string; // wallet address
  highestBidNumber: number;
  settled: boolean;
  endTime: number; // timestamp
  duration: number; // seconds
  nextMinBid: number;
  bidIncrementPercentage: number;
  timeExtension: number;
}

export interface BidHistoryRow {
  amount: number;
  bidderAddress: string;
  bidderUsername: string | null;
  bidderProfilePicture: string | null;
  blockTimestamp: number;
  currency: 'ETH' | 'SAGE';
}

const auctionsApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    getAuction: builder.query<Auction_include_Nft, number>({
      query: (auctionId: number) => `auctions?action=GetAuction&auctionId=${auctionId}`,
      providesTags: ['Auction'],
    }),
    getAuctionState: builder.query<AuctionState, number>({
      queryFn: async (auctionId: number, { dispatch }) => {
        console.log('getAuctionState()');
        try {
          const auctionState = await getAuctionContractState(auctionId);
          const newHighestBidEventCallback = () =>
            dispatch(auctionsApi.util.invalidateTags(['AuctionState']));
          setupBidListener(auctionId, newHighestBidEventCallback);
          return { data: auctionState };
        } catch (e) {
          return { error: { status: 400, data: {} } };
        }
      },
      providesTags: ['AuctionState'],
    }),
    getNftByAuctionAndWinner: builder.query<
      GamePrize,
      { auctionId: number; walletAddress: string }
    >({
      query: ({ auctionId, walletAddress }) =>
        `auctions?action=GetNftByAuctionAndWinner&auctionId=${auctionId}&winner=${walletAddress}`,
      providesTags: ['Auction'],
    }),
    getBidHistory: builder.query<BidHistoryRow[], number>({
      query: (auctionId) => `auctions?action=GetBidHistory&auctionId=${auctionId}`,
      providesTags: ['AuctionState'],
    }),
    getClaimedAuctionNfts: builder.query<GamePrize[], void>({
      query: () => `auctions?action=GetClaimedAuctionNfts`,
      providesTags: ['Auction'],
    }),
    getUnclaimedAuctionNfts: builder.query<GamePrize[], void>({
      query: () => `auctions?action=GetUnclaimedAuctionNfts`,
      providesTags: ['Auction'],
    }),
    placeBid: builder.mutation<null, BidArgs>({
      queryFn: async ({ auctionId, amount, signer }, {}, _, fetchWithBQ) => {
        console.log(`placeBid(${auctionId}, ${amount})`);
        // the missing `throw` here used to make this a no-op guard: a
        // 0/negative/NaN amount fell straight through to parseEther, which
        // — called outside any try/catch — threw an uncaught exception
        // instead of a clean toast error
        if (!amount || !Number.isFinite(amount) || amount <= 0) {
          toast.error('Enter a valid bid amount', { toastId: `bid${auctionId}` });
          return { data: null };
        }
        let weiValue: ethers.BigNumber;
        try {
          weiValue = ethers.utils.parseEther(amount.toString());
        } catch {
          toast.error('Enter a valid bid amount', { toastId: `bid${auctionId}` });
          return { data: null };
        }
        let isEthAuction = false;
        try {
          if (!signer) throw new Error('Please check wallet connection');
          const auctionContract = await getAuctionContract(signer);
          if (!auctionContract) throw new Error('Unable to reach Auction Contract');
          // ETH auctions carry the bid as msg.value — no ERC-20 approval step
          const currency = await auctionContract.auctionCurrency(auctionId);
          isEthAuction =
            currency?.toLowerCase() === NATIVE_CURRENCY_SENTINEL.toLowerCase();
          if (!isEthAuction) {
            const tokenAddress = await auctionContract.token();
            if (!Boolean(tokenAddress == parameters.ASHTOKEN_ADDRESS))
              throw new Error('incorrect SAGE Token address configuration');
            await approveERC20Transfer(tokenAddress, auctionContract.address, weiValue, signer);
          }
        } catch (e) {
          console.error(e);
          toast.error(`Error: ${extractErrorMessage(e)}`, {
            toastId: `approveERC20Transfer${auctionId}`,
          });
          return { data: null };
        }
        try {
          const auctionContract = await getAuctionContract(signer);
          const tx = await auctionContract.bid(
            auctionId,
            weiValue,
            isEthAuction ? { value: weiValue } : {}
          );
          promiseToast(tx, 'You are now the highest bidder!');
          await tx.wait();
          const blockTs = (await signer.provider.getBlock(tx.blockNumber)).timestamp;
          await fetchWithBQ(`auctions?action=SaveBid&id=${auctionId}&amt=${amount}&ts=${blockTs}`);
        } catch (e) {
          const errMsg = extractErrorMessage(e);
          toast.error(`Failure! ${errMsg}`, { toastId: `bid${auctionId}` });
          console.error(e);
        }
        return { data: null };
      },
      invalidatesTags: ['AuctionState'],
    }),
    claimAuction: builder.mutation<Date, { id: number; signer: Signer }>({
      queryFn: async ({ id, signer }, {}, _, fetchWithBQ) => {
        console.log(`claimAuction(${id})`);
        const contract = await getAuctionContract(signer);
        async function updateBackend() {
          console.log('claimAuction() :: updateBackend()');
          const claimedAt = await updateDbPrizeClaimedDate(fetchWithBQ, id);
          const auction = await contract.getAuction(id);
          await registerAuctionSale(id, auction.highestBid, auction.highestBidder, tx, signer);
          return { data: claimedAt };
        }
        try {
          var tx = await contract.settleAuction(id);
          promiseToast(tx, 'NFT claimed and moved to your collection!');
          await tx.wait(1);
          return await updateBackend();
        } catch (e) {
          console.error(e);
          const errMsg = extractErrorMessage(e);
          if (errMsg == 'Auction already settled') {
            return await updateBackend();
          } else {
            toast.error(`Failure! ${errMsg}`);
            return { error: { status: 500, data: null } };
          }
        }
      },
      invalidatesTags: ['Auction', 'AuctionState', 'Prizes'],
    }),
  }),
});

export async function getAuctionContractState(auctionId: number): Promise<AuctionState> {
  console.log(`getAuctionContractState(${auctionId})`);
  const auctionContract = await getAuctionContract();
  try {
    const auctionStruct = await auctionContract.getAuction(auctionId);
    const timeExtension = Number(auctionContract.DEFAULT_EXTENSION);
    const endTime = auctionStruct.endTime * 1000;
    const bidIncrementPercentage = await auctionContract.getBidIncrementPercentage();
    const highestBidNumber = utils.formatUnits(auctionStruct.highestBid);
    const nextMinBid = Number(
      utils.formatUnits(
        auctionStruct.highestBid
          .mul(BigNumber.from(10000).add(bidIncrementPercentage))
          .div(BigNumber.from(10000))
      )
    );
    return <AuctionState>{
      highestBidNumber: +highestBidNumber,
      highestBidder: auctionStruct.highestBidder,
      settled: auctionStruct.settled,
      endTime,
      duration: auctionStruct.duration,
      nextMinBid,
      bidIncrementPercentage: +bidIncrementPercentage,
      timeExtension,
    };
  } catch (e) {
    console.log(e);
    throw new Error('Error fetching auction state');
  }
}

/*
from Auction.sol:
event BidPlaced(
        uint256 indexed auctionId,
        address indexed newBidder,
        address indexed previousBidder,
        uint256 bidAmount,
        uint256 newEndTime
    );
*/
async function setupBidListener(auctionId: number, newBidHandler: () => void) {
  console.log(`setupBidListener(${auctionId})`);
  const auctionContract = await getAuctionContract();
  if (auctionContract.listenerCount('BidPlaced') < 1) {
    auctionContract.on(
      'BidPlaced',
      (auctionId, newBidder, previousBidder, bidAmount, newEndTime) => {
        console.log(
          `Contract Event: BidPlaced(${auctionId}, ${newBidder}, ${previousBidder}, ${bidAmount}, ${newEndTime})`
        );
        toast.info(
          `Auction ${auctionId} has a new higher bidder with a bid of ${bidAmount / 10 ** 18}`
        );
        newBidHandler();
      }
    );
  }
}

export type BidArgs = { auctionId: number; amount: number; signer: Signer };

async function updateDbPrizeClaimedDate(fetchWithBQ: any, auctionId: number): Promise<Date> {
  const { data } = await fetchWithBQ({
    url: `auctions?action=UpdateNftClaimedDate&auctionId=${auctionId}`,
    method: 'POST',
  });
  return (data as any).claimedAt as Date;
}

export const {
  useGetAuctionQuery,
  useGetAuctionStateQuery,
  useGetBidHistoryQuery,
  useGetNftByAuctionAndWinnerQuery,
  useClaimAuctionMutation,
  useGetClaimedAuctionNftsQuery,
  useGetUnclaimedAuctionNftsQuery,
  usePlaceBidMutation,
} = auctionsApi;
