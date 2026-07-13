import { baseApi } from './baseReducer';

export interface SocialAuthor {
  address: string;
  username: string | null;
  profilePicture: string | null;
  pfpVerified: boolean;
  verified: boolean; // paid checkmark
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
  tipTotalEth: number;
  boostBurned: number;
  isBoosted: boolean;
  collectPrice: number | null;
  collectCurrency: 'SAGE' | 'ETH';
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
  verified: boolean; // paid checkmark
  bio: string | null;
  bannerImageS3Path: string | null;
  followers: number;
  following: number;
  postCount: number;
  followedByViewer: boolean;
  isSelf: boolean;
  needsInvite: boolean; // self only: composer should ask for an invite code
  unreadMessages: number; // self only
  followGatedDrops: FollowGatedDrop[];
  myDrops: FollowGatedDrop[];
}

export interface OwnedNft {
  id: number;
  name: string;
  s3Path: string;
  s3PathOptimized: string;
}

export interface VerificationInfo {
  priceUsd: number;
  priceSage: number;
  priceEth: number;
  treasury: string;
  pointsPerSage: number;
}

export interface InviteCode {
  code: string;
  uses: number;
  maxUses: number;
  url: string;
}

export interface InvitePreview {
  code: string;
  valid: boolean;
  usesLeft: number;
  owner: { address: string; username: string | null; profilePicture: string | null };
}

export interface Conversation {
  partner: SocialUserCard;
  lastMessage: string;
  lastAt: string;
  unread: number;
}

export interface SocialUserCard {
  address: string;
  username: string | null;
  profilePicture?: string | null;
  verified: boolean;
}

export interface DirectMessage {
  id: number;
  from: string;
  text: string;
  createdAt: string;
  mine: boolean;
}

export interface ActivityItem {
  type: 'like' | 'repost' | 'tip' | 'collect' | 'follow' | 'reply';
  actor: SocialUserCard;
  postId?: number;
  snippet?: string;
  amount?: number;
  createdAt: string;
}

export interface LeaderboardRow {
  user: SocialUserCard;
  sage?: number;
  count?: number;
}

export interface Leaderboard {
  topEarners: LeaderboardRow[];
  topTippers: LeaderboardRow[];
  topBurners: LeaderboardRow[];
  mostFollowed: LeaderboardRow[];
}

export interface PostMint {
  tokenId: number;
  contractAddress: string;
  amount: number;
  pointsSpent: string | null;
  mintTxHash: string;
  createdAt: string;
  post: {
    id: number;
    text: string;
    imageUrl: string | null;
    author: { address: string; username: string | null; verified: boolean };
  };
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
    getVerificationInfo: builder.query<VerificationInfo, void>({
      query: () => ({ url: 'social?action=GetVerificationInfo' }),
    }),
    getMyInvites: builder.query<{ invites: InviteCode[] }, void>({
      query: () => ({ url: 'social?action=GetMyInvites' }),
      providesTags: ['SocialProfile'],
    }),
    getInvitePreview: builder.query<InvitePreview, string>({
      query: (code) => ({ url: `social?action=GetInvite&code=${code}` }),
    }),
    getConversations: builder.query<{ conversations: Conversation[] }, void>({
      query: () => ({ url: 'social?action=GetConversations' }),
      providesTags: ['SocialMessages'],
    }),
    getMessages: builder.query<{ messages: DirectMessage[] }, string>({
      query: (partner) => ({ url: `social?action=GetMessages&partner=${partner}` }),
      providesTags: ['SocialMessages'],
    }),
    getActivity: builder.query<{ activity: ActivityItem[] }, void>({
      query: () => ({ url: 'social?action=GetActivity' }),
      providesTags: ['SocialFeed'],
    }),
    getLeaderboard: builder.query<Leaderboard, void>({
      query: () => ({ url: 'social?action=GetLeaderboard' }),
      providesTags: ['SocialFeed'],
    }),
    getUserMints: builder.query<{ mints: PostMint[] }, string>({
      query: (address) => ({ url: `social?action=GetUserMints&address=${address}` }),
      providesTags: ['SocialFeed'],
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
      { ok: boolean; amount: number; currency: string },
      { postId: number; txHash: string; currency?: 'SAGE' | 'ETH' }
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
      { ok: boolean; collectPrice: number | null; collectCurrency: string },
      { postId: number; price: number | null; currency?: 'SAGE' | 'ETH' }
    >({
      query: (body) => ({ url: 'social?action=SetCollectible', method: 'POST', body }),
      invalidatesTags: (_r, _e, arg) => [{ type: 'SocialPost', id: arg.postId }, 'SocialFeed'],
    }),
    collectPost: builder.mutation<
      { ok: boolean; tokenId: number; mintTxHash: string; pointsSpent: string | null },
      { postId: number; txHash?: string; payWith?: 'SAGE' | 'POINTS' }
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
    purchaseVerification: builder.mutation<
      { ok: boolean; verified: boolean },
      { txHash: string; currency?: 'SAGE' | 'ETH' }
    >({
      query: (body) => ({ url: 'social?action=PurchaseVerification', method: 'POST', body }),
      invalidatesTags: ['SocialProfile', 'SocialFeed'],
    }),
    redeemInvite: builder.mutation<{ ok: boolean; joined: boolean }, { code: string }>({
      query: (body) => ({ url: 'social?action=RedeemInvite', method: 'POST', body }),
      invalidatesTags: ['SocialProfile', 'SocialFeed'],
    }),
    sendMessage: builder.mutation<{ ok: boolean; id: number }, { to: string; text: string }>({
      query: (body) => ({ url: 'social?action=SendMessage', method: 'POST', body }),
      invalidatesTags: ['SocialMessages'],
    }),
  }),
});

export const {
  useGetFeedQuery,
  useGetUserPostsQuery,
  useGetPostThreadQuery,
  useGetSocialProfileQuery,
  useGetOwnedNftsQuery,
  useGetVerificationInfoQuery,
  useGetMyInvitesQuery,
  useGetInvitePreviewQuery,
  useGetConversationsQuery,
  useGetMessagesQuery,
  useGetActivityQuery,
  useGetLeaderboardQuery,
  useGetUserMintsQuery,
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
  usePurchaseVerificationMutation,
  useRedeemInviteMutation,
  useSendMessageMutation,
} = socialApi;
