import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { User } from '@prisma/client';
import web3Modal from '@/utilities/web3Modal';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { parameters } from '@/constants/config';
import type { SafeUserUpdate } from '@/prisma/types';
import { getCsrfToken, signIn, signOut } from 'next-auth/react';
import { SiweMessage } from 'siwe';
// import {
//   playLikeDropSound,
//   playUnlikeDropSound,
//   playWalletConnectedSound,
// } from '../../utilities/sounds';

export type UserDisplayInfo = Pick<User, 'username' | 'displayName' | 'profilePicture'>;

export async function isOnCorrectNetwork(): Promise<boolean> {
  try {
    const envChainId = +parameters.CHAIN_ID;
    const provider = new ethers.providers.Web3Provider(await web3Modal.connect());
    return (await provider.getNetwork()).chainId == envChainId;
  } catch (e) {
    return false;
  }
}

//async function switchToCorrectNetwork(networkName: string, chainId: number) {
//  toast.warn(`Please switch to ${networkName} network!`, {
//    autoClose: false,
//    closeButton: false,
//    closeOnClick: false,
//    position: toast.POSITION.TOP_CENTER,
//    onClick: async () => {
//      //click the toast notification to initiate network change
//      try {
//        await window.ethereum.request({
//          method: 'wallet_switchEthereumChain',
//          params: [
//            {
//              chainId: ethers.utils.hexValue(chainId),
//            },
//          ],
//        });
//      } catch (switchError: any) {
//        // This error code indicates that the chain has not been added to MetaMask.
//        if (switchError.code === 4902) {
//          try {
//            await window.ethereum.request({
//              method: 'wallet_addEthereumChain',
//              params: [
//                {
//                  chainId: ethers.utils.hexValue(chainId),
//                  chainName: networkName,
//                  nativeCurrency: {
//                    name: 'FTM',
//                    symbol: 'FTM',
//                    decimals: 18,
//                  },
//                  rpcUrls: [process.env.NEXT_PUBLIC_RPC_URL],
//                },
//              ],
//            });
//          } catch (addError) {
//            console.error(addError);
//          }
//        } else {
//          console.error(switchError);
//        }
//      }
//    },
//  });
//}

export const userApi = createApi({
  reducerPath: 'userApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }),
  tagTypes: ['User', 'Wallet'],
  endpoints: (builder) => ({
    signIn: builder.mutation<null, { message: SiweMessage; signature: string }>({
      queryFn: async ({ message, signature }) => {
        await signIn('credentials', {
          message: JSON.stringify(message),
          redirect: false,
          signature,
        });
        return { data: null };
      },
      invalidatesTags: ['User'],
    }),
    signOut: builder.mutation<null, null>({
      queryFn: async () => {
        signOut({ redirect: false });
        return { data: null };
      },
      invalidatesTags: ['User'],
    }),
    getUser: builder.query<User, void>({
      query: () => {
        return {
          url: 'api/user',
          method: 'GET',
        };
      },
      providesTags: ['User'],
    }),
    getUserDisplayInfo: builder.query<UserDisplayInfo, string>({
      query: (address: string) => {
        return {
          url: `api/user/?wallet=${address}`,
          method: 'GET',
        };
      },
    }),
    updateUser: builder.mutation<User, SafeUserUpdate>({
      query: (user) => {
        return {
          url: 'api/user',
          method: 'PATCH',
          body: { user },
        };
      },
      onQueryStarted: async (_user, { queryFulfilled }) => {
        toast.promise(queryFulfilled, {
          pending: 'Updating Profile',
          success: 'Successfully updated profile.',
          error: 'Error Updating Profile',
        });
      },
      invalidatesTags: ['User'],
    }),
    getSearchResults: builder.query<any, { term: string; category: string }>({
      query: ({ category, term }) => {
        return {
          url: 'api/search',
          method: 'GET',
          params: {
            term,
            category,
          },
        };
      },
    }),
  }),
});

export const {
  useGetSearchResultsQuery,
  useGetUserQuery,
  useGetUserDisplayInfoQuery,
  useUpdateUserMutation,
  useSignInMutation,
  useSignOutMutation,
} = userApi;
