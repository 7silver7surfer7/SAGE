import { baseApi } from './baseReducer';

export interface SocialAuthor {
  address: string;
  username: string | null;
  profilePicture: string | null;
  pfpVerified: boolean;
}

export interface SocialPost {
  id: number;
  text: string;
  imageUrl: string | null;
  createdAt: string;
  replyToId: number | null;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  tipTotal: number;
  boostBurned: number;
  isBoosted: boolean;
  collectPrice: number | null;
  collectCount: number;
  author: SocialAuthor;
  likedByViewer: boolean;
  repostedByViewer: boolean;
  collectedByViewer: boolean;
}

export interface FollowGatedDrop {
  id: number;
  name: string;
  followGateEnabled?: boolean;
}

export interface SocialProfile {
  address: string;
  username: string | null;
  profilePicture: string | null;
  pfpVerified: boolean;
  bio: string | null;
  bannerImageS3Path: string | null;
  followers: number;
  following: number;
  postCount: number;
  followedByViewer: boolean;
  isSelf: boolean;
  // public: drops whose allowlist a follow of this profile earns a spot on
  followGatedDrops: FollowGatedDrop[];
  // own profile only: all whitelisted drops, for the follow-gate toggles
  myDrops: FollowGatedDrop[];
}

export interface OwnedNft {
  id: number;
  name: string;
  s3Path: string;
  s3PathOptimized: string;
}

type Scope = 'global' | 'following';

const socialApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    getFeed: builder.query<{ posts: SocialPost[]; nextCursor: number | null }, Scope>({
      query: (scope) => ({ url: `social?action=GetFeed&scope=${scope}` }),
      providesTags: ['SocialFeed'],
    }),
    getUserPosts: builder.query<{ posts: SocialPost[] }, string>({
      query: (address) => ({ url: `social?action=GetUserPosts&address=${address}` }),
      providesTags: ['SocialFeed'],
    }),
    getPostThread: builder.query<{ post: SocialPost; replies: SocialPost[] }, number>({
      query: (id) => ({ url: `social?action=GetPost&id=${id}` }),
      providesTags: (_r, _e, id) => [{ type: 'SocialPost', id }],
    }),
    getSocialProfile: builder.query<SocialProfile, string>({
      query: (address) => ({ url: `social?action=GetProfile&address=${address}` }),
      providesTags: (_r, _e, address) => [{ type: 'SocialProfile', id: address }],
    }),
    getOwnedNfts: builder.query<{ nfts: OwnedNft[] }, void>({
      query: () => ({ url: 'social?action=GetOwnedNfts' }),
    }),
    createPost: builder.mutation<
      { post: SocialPost },
      { text: string; imageUrl?: string; replyToId?: number }
    >({
      query: (body) => ({ url: 'social?action=CreatePost', method: 'POST', body }),
      invalidatesTags: (_r, _e, arg) =>
        arg.replyToId ? [{ type: 'SocialPost', id: arg.replyToId }, 'SocialFeed'] : ['SocialFeed'],
    }),
    toggleLike: builder.mutation<{ liked: boolean }, number>({
      query: (postId) => ({ url: 'social?action=ToggleLike', method: 'POST', body: { postId } }),
      invalidatesTags: ['SocialFeed'],
    }),
    toggleRepost: builder.mutation<{ reposted: boolean }, number>({
      query: (postId) => ({ url: 'social?action=ToggleRepost', method: 'POST', body: { postId } }),
      invalidatesTags: ['SocialFeed'],
    }),
    toggleFollow: builder.mutation<{ following: boolean; whitelistedFor?: string[] }, string>({
      query: (address) => ({ url: 'social?action=ToggleFollow', method: 'POST', body: { address } }),
      invalidatesTags: (_r, _e, address) => [{ type: 'SocialProfile', id: address }, 'SocialFeed'],
    }),
    recordTip: builder.mutation<
      { ok: boolean; amount: number },
      { postId: number; txHash: string }
    >({
      query: (body) => ({ url: 'social?action=RecordTip', method: 'POST', body }),
      invalidatesTags: ['SocialFeed'],
    }),
    boostPost: builder.mutation<
      { ok: boolean; amount: number; boostedUntil: string },
      { postId: number; txHash: string }
    >({
      query: (body) => ({ url: 'social?action=BoostPost', method: 'POST', body }),
      invalidatesTags: ['SocialFeed'],
    }),
    setCollectible: builder.mutation<
      { ok: boolean; collectPrice: number | null },
      { postId: number; price: number | null }
    >({
      query: (body) => ({ url: 'social?action=SetCollectible', method: 'POST', body }),
      invalidatesTags: (_r, _e, arg) => [{ type: 'SocialPost', id: arg.postId }, 'SocialFeed'],
    }),
    collectPost: builder.mutation<
      { ok: boolean; tokenId: number; mintTxHash: string },
      { postId: number; txHash?: string }
    >({
      query: (body) => ({ url: 'social?action=CollectPost', method: 'POST', body }),
      invalidatesTags: (_r, _e, arg) => [{ type: 'SocialPost', id: arg.postId }, 'SocialFeed'],
    }),
    setNftPfp: builder.mutation<
      { ok: boolean; profilePicture: string; pfpVerified: boolean },
      number
    >({
      query: (nftId) => ({ url: 'social?action=SetNftPfp', method: 'POST', body: { nftId } }),
      invalidatesTags: ['SocialProfile', 'SocialFeed', 'User'],
    }),
    setFollowGate: builder.mutation<
      { ok: boolean; enabled: boolean; backfilled: number },
      { dropId: number; enabled: boolean }
    >({
      query: (body) => ({ url: 'social?action=SetFollowGate', method: 'POST', body }),
      invalidatesTags: ['SocialProfile'],
    }),
  }),
});

export const {
  useGetFeedQuery,
  useGetUserPostsQuery,
  useGetPostThreadQuery,
  useGetSocialProfileQuery,
  useGetOwnedNftsQuery,
  useCreatePostMutation,
  useToggleLikeMutation,
  useToggleRepostMutation,
  useToggleFollowMutation,
  useRecordTipMutation,
  useBoostPostMutation,
  useSetCollectibleMutation,
  useCollectPostMutation,
  useSetNftPfpMutation,
  useSetFollowGateMutation,
} = socialApi;
