import { baseApi } from './baseReducer';
import { BigNumber, ethers, Signer } from 'ethers';
import { getERC20Contract, getNFTContract } from '@/utilities/contracts';
import { parameters } from '@/constants/config';
import { promiseToast } from '@/utilities/toast';
import { fetchOrCreateNftContract } from './nftsReducer';

export interface NftContractBalance {
  balance: string;
  artistSplit: string;
  sageSplit: string;
}

const artistsApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    getArtistBalance: builder.query<NftContractBalance, string>({
      queryFn: async (artistContractAddress) => {
        const erc20Contract = await getERC20Contract();
        const fullBalance = await erc20Contract.balanceOf(artistContractAddress);
        const artistSplit = fullBalance.mul(BigNumber.from(80)).div(BigNumber.from(100));
        const sageSplit = fullBalance.sub(artistSplit);
        const data = <NftContractBalance>{
          balance: ethers.utils.formatUnits(fullBalance),
          artistSplit: ethers.utils.formatUnits(artistSplit),
          sageSplit: ethers.utils.formatUnits(sageSplit),
        };
        return { data };
      },
      providesTags: ['ArtistBalance'],
    }),
    getArtistNftContractAddress: builder.query<string | null, string>({
      queryFn: async (artistAddress, {}, _, fetchWithBQ) => {
        const { data: response } = await fetchWithBQ(
          `drops?action=GetNftContractAddress&address=${artistAddress}`
        );
        const data = (response as any).contractAddress;
        console.log(`getArtistNftContractAddress() :: ${data}`);
        return { data };
      },
      providesTags: ['ArtistNftContract'],
    }),
    deployArtistNftContract: builder.mutation<string, { artistAddress: string; signer: Signer }>({
      queryFn: async ({ artistAddress, signer }, {}, _, fetchWithBQ) => {
        const artistNftContractAddress = await fetchOrCreateNftContract(
          artistAddress,
          signer,
          fetchWithBQ
        );
        console.log(`deployArtistNftContract() :: ${artistNftContractAddress}`);
        return { data: artistNftContractAddress };
      },
      invalidatesTags: ['ArtistNftContract'],
    }),
    withdrawArtistBalance: builder.mutation<
      null,
      { artistContractAddress: string; signer: Signer }
    >({
      queryFn: async ({ artistContractAddress, signer }) => {
        const { ASHTOKEN_ADDRESS } = parameters;
        const contract = await getNFTContract(artistContractAddress, signer as Signer);
        var tx = await contract.withdrawERC20(ASHTOKEN_ADDRESS);
        promiseToast(tx, 'Balance has been withdrawed!');
        await tx.wait();
        return { data: null };
      },
      invalidatesTags: ['ArtistBalance'],
    }),
  }),
});

export const {
  useGetArtistBalanceQuery,
  useGetArtistNftContractAddressQuery,
  useDeployArtistNftContractMutation,
  useWithdrawArtistBalanceMutation,
} = artistsApi;
