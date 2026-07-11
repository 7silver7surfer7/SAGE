import { extractErrorMessage, getStorageContract } from '@/utilities/contracts';
import { User_include_EarnedPointsAndNftContracts } from '@/prisma/types';
import { ethers, Signer } from 'ethers';
import { toast } from 'react-toastify';
import { baseApi } from './baseReducer';
import { SaleEvent } from '@prisma/client';

// Turn a failed promote response into an accurate message. The API returns a
// typed { error } code so we don't blame admin rights for every failure.
function promotionErrorMessage(error: any): string {
  const code = (error?.data as any)?.error ?? error?.status;
  if (code === 'FORBIDDEN' || code === 403) return 'Only an admin can promote users.';
  if (code === 'INVALID_ADDRESS' || code === 400)
    return 'That does not look like a valid wallet address.';
  return 'Promotion failed. Please try again.';
}

// Grant an on-chain role on the Storage contract. Best-effort: the app gates
// artist/admin by the DATABASE role, so a failed on-chain grant (testnet gas,
// admin wallet missing the on-chain role, contract not wired) must NOT block
// the promotion — it only affects on-chain artist operations, which can be
// re-synced later. Returns true if the grant landed.
async function grantOnChainRole(role: string, walletAddress: string, signer: Signer): Promise<boolean> {
  try {
    const contract = await getStorageContract(signer);
    const tx = await contract.grantRole(
      ethers.utils.solidityKeccak256(['string'], [role]),
      walletAddress
    );
    await tx.wait();
    return true;
  } catch (e) {
    console.error(`grantOnChainRole(${role}, ${walletAddress}) failed`, e);
    return false;
  }
}

// SageStorage key holding the platform's royalty receiver. When unset (zero),
// contracts fall back to the multisig. The dashboard writes this key directly
// on-chain from the connected admin wallet — there is no DB copy.
const PLATFORM_ROYALTY_KEY = ethers.utils.solidityKeccak256(['string'], ['address.royalty']);
export const DEFAULT_PLATFORM_ROYALTY_ADDRESS = '0x3E099aF007CaB8233D44782D8E6fe80FECDC321e';

// SageConfig (resolved via SageStorage address.config) holds the ARTIST share
// of primary sales in bps under share.primaryArtist; 0/unset = contracts fall
// back to 8000 (platform 20%). The dashboard shows the PLATFORM cut percent.
const CONFIG_ADDRESS_KEY = ethers.utils.solidityKeccak256(['string'], ['address.config']);
const PRIMARY_ARTIST_SHARE_KEY = ethers.utils.solidityKeccak256(['string'], ['share.primaryArtist']);
export const DEFAULT_PLATFORM_PRIMARY_CUT_PCT = 20;
const SAGE_CONFIG_ABI = [
  'function getUint(bytes32) view returns (uint256)',
  'function setUint(bytes32, uint256)',
];

async function getSageConfigContract(signer?: Signer) {
  const storage = await getStorageContract();
  const address = await storage.getAddress(CONFIG_ADDRESS_KEY);
  if (address === ethers.constants.AddressZero) return null;
  const provider = signer ?? storage.provider;
  return new ethers.Contract(address, SAGE_CONFIG_ABI, provider as any);
}

const dashboardApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    getAllUsersAndEarnedPoints: builder.query<User_include_EarnedPointsAndNftContracts[], void>({
      query: () => 'user?action=GetAllUsersAndEarnedPoints',
      providesTags: ['AllUsers'],
    }),
    getConfig: builder.query<{ featuredDropId: number; welcomeMessage: string }, void>({
      query: () => `config`,
      providesTags: ['Config'],
    }),
    getSalesEvents: builder.query<SaleEvent[], void>({
      query: () => `sales?action=GetSalesEvents`
    }),
    promoteUserToAdmin: builder.mutation<boolean, { walletAddress: string; signer: Signer }>({
      queryFn: async ({ walletAddress, signer }, {}, _, fetchWithBQ) => {
        // DB role is the app's source of truth and is admin-guarded server-side,
        // so set it first — this is what makes the promotion actually "take".
        const result = await fetchWithBQ(`user?action=PromoteToAdmin&address=${walletAddress}`);
        if (result.error) {
          toast.error(promotionErrorMessage(result.error));
          return { data: false };
        }
        const onChain = await grantOnChainRole('role.admin', walletAddress, signer);
        toast[onChain ? 'success' : 'warn'](
          onChain
            ? 'Promoted to ADMIN.'
            : 'Promoted to ADMIN (on-chain role sync failed — retry when the wallet/contract is available).'
        );
        return { data: true };
      },
      invalidatesTags: ['AllUsers'],
    }),
    promoteUserToArtist: builder.mutation<boolean, { walletAddress: string; signer: Signer }>({
      queryFn: async ({ walletAddress, signer }, {}, _, fetchWithBQ) => {
        console.log(`promoteUserToArtist(${walletAddress})`);
        const result = await fetchWithBQ(`user?action=PromoteToArtist&address=${walletAddress}`);
        if (result.error) {
          toast.error(promotionErrorMessage(result.error));
          return { data: false };
        }
        const onChain = await grantOnChainRole('role.artist', walletAddress, signer);
        toast[onChain ? 'success' : 'warn'](
          onChain
            ? 'Promoted to ARTIST.'
            : 'Promoted to ARTIST (on-chain role sync failed — retry when the wallet/contract is available).'
        );
        return { data: true };
      },
      invalidatesTags: ['AllUsers'],
    }),
    getPlatformRoyaltyAddress: builder.query<string, void>({
      queryFn: async () => {
        try {
          const contract = await getStorageContract();
          const value = await contract.getAddress(PLATFORM_ROYALTY_KEY);
          return { data: value as string };
        } catch (e) {
          console.error('getPlatformRoyaltyAddress failed', e);
          return { data: ethers.constants.AddressZero };
        }
      },
      providesTags: ['PlatformRoyaltyAddress'],
    }),
    getPrimaryPlatformCut: builder.query<number, void>({
      queryFn: async () => {
        try {
          const config = await getSageConfigContract();
          if (!config) return { data: DEFAULT_PLATFORM_PRIMARY_CUT_PCT };
          const artistShareBps = Number(await config.getUint(PRIMARY_ARTIST_SHARE_KEY));
          if (!artistShareBps) return { data: DEFAULT_PLATFORM_PRIMARY_CUT_PCT };
          return { data: (10000 - artistShareBps) / 100 };
        } catch (e) {
          console.error('getPrimaryPlatformCut failed', e);
          return { data: DEFAULT_PLATFORM_PRIMARY_CUT_PCT };
        }
      },
      providesTags: ['PrimaryPlatformCut'],
    }),
    setPrimaryPlatformCut: builder.mutation<boolean, { platformCutPct: number; signer: Signer }>({
      queryFn: async ({ platformCutPct, signer }) => {
        try {
          const config = await getSageConfigContract(signer);
          if (!config) {
            toast.error('SageConfig is not registered on-chain yet.');
            return { data: false };
          }
          const artistShareBps = Math.round((100 - platformCutPct) * 100);
          const tx = await config.setUint(PRIMARY_ARTIST_SHARE_KEY, artistShareBps);
          await tx.wait();
          toast.success(`Platform primary-sale cut set to ${platformCutPct}% on-chain.`);
          return { data: true };
        } catch (e) {
          toast.error(`Failed to update: ${extractErrorMessage(e)}`);
          return { data: false };
        }
      },
      invalidatesTags: ['PrimaryPlatformCut'],
    }),
    setPlatformRoyaltyAddress: builder.mutation<boolean, { address: string; signer: Signer }>({
      queryFn: async ({ address, signer }) => {
        try {
          const contract = await getStorageContract(signer);
          const tx = await contract.setAddress(PLATFORM_ROYALTY_KEY, address);
          await tx.wait();
          toast.success('Platform royalty address updated on-chain.');
          return { data: true };
        } catch (e) {
          toast.error(`Failed to update: ${extractErrorMessage(e)}`);
          return { data: false };
        }
      },
      invalidatesTags: ['PlatformRoyaltyAddress'],
    }),
    updateConfig: builder.mutation<null, { featuredDropId: Number; welcomeMessage: string }>({
      queryFn: async ({ featuredDropId, welcomeMessage }, {}, _, fetchWithBQ) => {
        await fetchWithBQ({
          url: 'config',
          method: 'PATCH',
          body: { featuredDropId, welcomeMessage },
        });
        return { data: null };
      },
      invalidatesTags: ['Config'],
    }),
  }),
});

export const {
  useGetAllUsersAndEarnedPointsQuery,
  useGetConfigQuery,
  useGetPlatformRoyaltyAddressQuery,
  useGetPrimaryPlatformCutQuery,
  useGetSalesEventsQuery,
  usePromoteUserToAdminMutation,
  usePromoteUserToArtistMutation,
  useSetPlatformRoyaltyAddressMutation,
  useSetPrimaryPlatformCutMutation,
  useUpdateConfigMutation,
} = dashboardApi;
