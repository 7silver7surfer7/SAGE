import { User } from '@prisma/client';
import { toast } from 'react-toastify';
import type { SafeUserUpdate } from '@/prisma/types';
import { signIn, signOut } from 'next-auth/react';
import { SiweMessage } from 'siwe';
import { baseApi } from './baseReducer';
import { uploadFileToArweave } from '@/utilities/arweave-client';

export type UserDisplayInfo = Pick<User, 'username' | 'profilePicture'>;

// export async function isOnCorrectNetwork(): Promise<boolean> {
//   try {
//     const envChainId = +parameters.CHAIN_ID;
//     const provider = new ethers.providers.Web3Provider(await web3Modal.connect());
//     return (await provider.getNetwork()).chainId == envChainId;
//   } catch (e) {
//     return false;
//   }
// }
const usersApi = baseApi.injectEndpoints({
  overrideExisting: true,
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
    signOut: builder.mutation<null, void>({
      queryFn: () => {
        signOut({ redirect: false });
        return { data: null };
      },
      invalidatesTags: [
        'EscrowPoints',
        'Following',
        'Nfts',
        'Prizes',
        'TicketCount',
        'User',
        'UserPoints',
        'Wallet',
      ],
    }),
    getUser: builder.query<User, void>({
      query: () => {
        return {
          url: 'user',
          method: 'GET',
        };
      },
      providesTags: ['User'],
    }),
    getUserDisplayInfo: builder.query<UserDisplayInfo, string>({
      query: (address: string) => {
        return {
          url: `user/?wallet=${address}`,
          method: 'GET',
        };
      },
    }),
    updateArtist: builder.mutation<null, { user: SafeUserUpdate; bannerFile: File }>({
      queryFn: async ({ user, bannerFile }, { dispatch }) => {
        // Banner is hosted on Arweave; store the optimized (display) URL.
        const { optimizedUrl } = await uploadFileToArweave(bannerFile);
        user.bannerImageS3Path = optimizedUrl;
        dispatch(usersApi.endpoints.updateUser.initiate(user));
        return { data: null };
      },
    }),
    updateUser: builder.mutation<null, SafeUserUpdate>({
      queryFn: async (user, {}, _, fetchWithBQ) => {
        try {
          const result = await fetchWithBQ({
            url: 'user',
            method: 'PATCH',
            body: { user },
          });
          const { data } = result;
          if ((data as any).error) {
            if ('Unique constraint violation' == (data as any).error) {
              toast.error(
                `Update failed: username '${user.username}' is already in use, please pick another one!`
              );
            } else {
              console.log(data);
              toast.error('Error updating profile.');
            }
          } else {
            toast.success('Successfully updated profile.');
          }
        } catch (e) {
          toast.error('Error updating profile.');
        }
        return { data: null };
      },
      invalidatesTags: ['User'],
    }),
    getIsFollowing: builder.query<string[], void>({
      query: () => 'user?action=GetIsFollowing',
      providesTags: ['Following'],
    }),
    setIsFollowing: builder.mutation<null, { address: string; isFollowing: boolean }>({
      query: ({ address, isFollowing }) =>
        `user?action=SetIsFollowing&address=${address}&isFollowing=${isFollowing.toString()}`,
      invalidatesTags: ['Following'],
    }),
    getSearchResults: builder.query<any, { term: string; category: string }>({
      query: ({ category, term }) => {
        return {
          url: 'search',
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
  useUpdateArtistMutation,
  useGetIsFollowingQuery,
  useSetIsFollowingMutation,
  useSignInMutation,
  useSignOutMutation,
} = usersApi;
