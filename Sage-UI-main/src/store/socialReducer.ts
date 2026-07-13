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
  mediaType: 'image' | 'video' | null;
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
  collectCurrency: 'SAGE' | 'ETH' | 'POINTS';
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
  webpage: string | null;
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
  groupChat: { enabled: boolean; isMember: boolean } | null;
}

export interface GroupMessage {
  id: number;
  from: SocialUserCard;
  text: string;
  createdAt: string;
  mine: boolean;
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

export type Conversation =
  | { isGroup: false; partner: SocialUserCard; lastMessage: string; lastAt: string; unread: number }
  | { isGroup: true; owner: string; partner: SocialUserCard; lastMessage: string; lastAt: string; unread: number; isOwner: boolean };

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

export interface GlobalEvent {
  type: 'tip' | 'collect' | 'boost' | 'follow' | 'post';
  actor: SocialUserCard;
  target: SocialUserCard | null;
  postId?: number;
  amount?: number;
  currency?: string;
  createdAt: string;
}

export interface LeaderboardRow {
  user: SocialUserCard;
  sage?: number;
  count?: number;
}

export interface Leaderboard {
  topPoints: LeaderboardRow[];
  topEarners: LeaderboardRow[];
  topTippers: LeaderboardRow[];
  topBurners: LeaderboardRow[];
  mostFollowed: LeaderboardRow[];
}

export interface PostMint {
  source: 'collect' | 'owned';
  kind: 'nft';
  ref: string;
  tokenId: number;
  contractAddress: string;
  pointsSpent: string | null;
  createdAt: string | null;
  image: string | null;
  title: string;
  post: {
    id: number;
    text: string;
    imageUrl: string | null;
    author: { address: string; username: string | null; verified: boolean };
  } | null;
}

export interface ProfileToken {
  tokenAddress: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  airdropEnabled: boolean;
  airdropCount: number;
}
export interface ProfileTokenResponse {
  token: ProfileToken | null;
  factory: string | null;
  followers: string[];
}
export interface CollectVoucher {
  ok: boolean;
  minter: string;
  postId: number;
  uri: string;
  signature: string;
}

export interface TokenTrade {
  side: 'buy' | 'sell';
  trader: string;
  ethAmount: number;
  tokenAmount: number;
  createdAt: string;
}
export interface TokenHolder {
  user: SocialUserCard;
  balance: number;
}
export interface TokenDetail {
  token: {
    tokenAddress: string;
    name: string;
    symbol: string;
    imageUrl: string | null;
    airdropEnabled: boolean;
    creator: SocialUserCard;
  };
  priceEth: number;
  complete: boolean;
  bondingProgressPct: number;
  holderCount: number;
  tradeCount: number;
  series: { t: string; price: number }[];
  trades: TokenTrade[];
  holders: TokenHolder[];
}

type Scope = 'global' | 'latest' | 'following';

export interface FeedPage {
  posts: SocialPost[];
  nextCursor: number | null;
}

const socialApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    // Infinite scroll: one cache entry PER SCOPE that pages merge into.
    // cursor=undefined replaces the list (fresh load / new post), a cursor
    // appends deduped older posts.
    getFeed: builder.query<FeedPage, { scope: Scope; cursor?: number }>({
      query: ({ scope, cursor }) => ({
        url: `social?action=GetFeed&scope=${scope}${cursor ? `&cursor=${cursor}` : ''}`,
      }),
      serializeQueryArgs: ({ queryArgs }) => `feed-${queryArgs.scope}`,
      merge: (current, incoming, { arg }) => {
        if (!arg.cursor) return incoming;
        const seen = new Set(current.posts.map((p) => p.id));
        current.posts.push(...incoming.posts.filter((p) => !seen.has(p.id)));
        current.nextCursor = incoming.nextCursor;
        return current;
      },
      forceRefetch: ({ currentArg, previousArg }) =>
        currentArg?.cursor !== previousArg?.cursor || currentArg?.scope !== previousArg?.scope,
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
    getBoostInfo: builder.query<{ priceUsd: number; priceSage: number }, void>({
      query: () => ({ url: 'social?action=GetBoostInfo' }),
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
    getGlobalActivity: builder.query<{ events: GlobalEvent[] }, void>({
      query: () => ({ url: 'social?action=GetGlobalActivity' }),
      providesTags: ['SocialFeed'],
    }),
    getGroupChat: builder.query<
      { enabled: boolean; isOwner: boolean; members: SocialUserCard[]; messages: GroupMessage[] },
      string
    >({
      query: (owner) => ({ url: `social?action=GetGroupChat&owner=${owner}` }),
      providesTags: ['SocialMessages'],
    }),
    getProfileToken: builder.query<ProfileTokenResponse, string>({
      query: (address) => ({ url: `social?action=GetProfileToken&address=${address}` }),
      providesTags: (_r, _e, address) => [{ type: 'SocialProfile', id: address }],
    }),
    getTokenDetail: builder.query<TokenDetail, string>({
      query: (address) => ({ url: `social?action=GetTokenDetail&address=${address}` }),
      providesTags: (_r, _e, address) => [{ type: 'SocialProfile', id: `tok-${address}` }],
    }),
    searchSocial: builder.query<{ users: SocialUserCard[]; posts: SocialPost[] }, string>({
      query: (q) => ({ url: `social?action=Search&q=${encodeURIComponent(q)}` }),
    }),
    createPost: builder.mutation<
      { post: SocialPost },
      { text: string; imageUrl?: string; mediaType?: 'image' | 'video'; replyToId?: number }
    >({
      query: (body) => ({ url: 'social?action=CreatePost', method: 'POST', body }),
      invalidatesTags: (_r, _e, arg) =>
        arg.replyToId ? [{ type: 'SocialPost', id: arg.replyToId }, 'SocialFeed'] : ['SocialFeed'],
    }),
    toggleLike: builder.mutation<{ liked: boolean }, number>({
      query: (postId) => ({ url: 'social?action=ToggleLike', method: 'POST', body: { postId } }),
      // optimistic: paginated feed pages beyond the newest are append-only in
      // the cache, so patch them directly instead of waiting for a refetch
      async onQueryStarted(postId, { dispatch, queryFulfilled }) {
        const patches = (['global', 'following'] as const).map((scope) =>
          dispatch(
            socialApi.util.updateQueryData('getFeed', { scope }, (draft) => {
              const p = draft.posts.find((x) => x.id === postId);
              if (p) {
                p.likedByViewer = !p.likedByViewer;
                p.likeCount += p.likedByViewer ? 1 : -1;
              }
            })
          )
        );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
      invalidatesTags: ['SocialFeed'],
    }),
    toggleRepost: builder.mutation<{ reposted: boolean }, number>({
      query: (postId) => ({ url: 'social?action=ToggleRepost', method: 'POST', body: { postId } }),
      async onQueryStarted(postId, { dispatch, queryFulfilled }) {
        const patches = (['global', 'following'] as const).map((scope) =>
          dispatch(
            socialApi.util.updateQueryData('getFeed', { scope }, (draft) => {
              const p = draft.posts.find((x) => x.id === postId);
              if (p) {
                p.repostedByViewer = !p.repostedByViewer;
                p.repostCount += p.repostedByViewer ? 1 : -1;
              }
            })
          )
        );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
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
      { postId: number; price: number | null }
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
    deletePost: builder.mutation<{ ok: boolean }, number>({
      query: (postId) => ({ url: 'social?action=DeletePost', method: 'POST', body: { postId } }),
      async onQueryStarted(postId, { dispatch, queryFulfilled }) {
        const patches = (['global', 'following'] as const).map((scope) =>
          dispatch(
            socialApi.util.updateQueryData('getFeed', { scope }, (draft) => {
              draft.posts = draft.posts.filter((x) => x.id !== postId);
            })
          )
        );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
      invalidatesTags: ['SocialFeed'],
    }),
    sendMessage: builder.mutation<{ ok: boolean; id: number }, { to: string; text: string }>({
      query: (body) => ({ url: 'social?action=SendMessage', method: 'POST', body }),
      invalidatesTags: ['SocialMessages'],
    }),
    recordTokenLaunch: builder.mutation<
      { ok: boolean; token: string },
      {
        tokenAddress: string;
        name: string;
        symbol: string;
        launchTxHash: string;
        imageUrl?: string;
        airdropEnabled?: boolean;
      }
    >({
      query: (body) => ({ url: 'social?action=RecordTokenLaunch', method: 'POST', body }),
      invalidatesTags: ['SocialProfile'],
    }),
    recordAirdrop: builder.mutation<{ ok: boolean }, { count: number }>({
      query: (body) => ({ url: 'social?action=RecordAirdrop', method: 'POST', body }),
      invalidatesTags: ['SocialProfile'],
    }),
    toggleHideItem: builder.mutation<
      { ok: boolean; hidden: boolean },
      { kind: 'token' | 'edition' | 'nft'; ref: string; hide: boolean }
    >({
      query: (body) => ({ url: 'social?action=ToggleHideItem', method: 'POST', body }),
      invalidatesTags: ['SocialProfile', 'SocialFeed'],
    }),
    recordTrade: builder.mutation<
      { ok: boolean; priceEth?: number },
      { tokenAddress: string; side: 'buy' | 'sell'; txHash: string }
    >({
      query: (body) => ({ url: 'social?action=RecordTrade', method: 'POST', body }),
      invalidatesTags: (_r, _e, arg) => [{ type: 'SocialProfile', id: `tok-${arg.tokenAddress}` }],
    }),
    sendGroupMessage: builder.mutation<{ ok: boolean; id: number }, { owner: string; text: string }>({
      query: (body) => ({ url: 'social?action=SendGroupMessage', method: 'POST', body }),
      invalidatesTags: ['SocialMessages'],
    }),
    toggleGroupChat: builder.mutation<{ ok: boolean; enabled: boolean }, { enabled: boolean }>({
      query: (body) => ({ url: 'social?action=ToggleGroupChat', method: 'POST', body }),
      invalidatesTags: ['SocialProfile'],
    }),
    kickFromGroupChat: builder.mutation<{ ok: boolean }, { address: string }>({
      query: (body) => ({ url: 'social?action=KickFromGroupChat', method: 'POST', body }),
      invalidatesTags: ['SocialMessages'],
    }),
    setProfileImage: builder.mutation<
      { ok: boolean; url: string; kind: string },
      { url: string; kind: 'avatar' | 'banner' }
    >({
      query: (body) => ({ url: 'social?action=SetProfileImage', method: 'POST', body }),
      invalidatesTags: ['SocialProfile', 'SocialFeed', 'User'],
    }),
    requestCollectVoucher: builder.mutation<
      CollectVoucher,
      { postId: number; txHash?: string; payWith?: 'SAGE' | 'POINTS' }
    >({
      query: (body) => ({ url: 'social?action=RequestCollectVoucher', method: 'POST', body }),
      invalidatesTags: (_r, _e, arg) => [{ type: 'SocialPost', id: arg.postId }, 'SocialFeed'],
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
  useGetBoostInfoQuery,
  useGetMyInvitesQuery,
  useGetInvitePreviewQuery,
  useGetConversationsQuery,
  useGetMessagesQuery,
  useGetActivityQuery,
  useGetLeaderboardQuery,
  useGetUserMintsQuery,
  useGetGlobalActivityQuery,
  useGetProfileTokenQuery,
  useSearchSocialQuery,
  useDeletePostMutation,
  useGetGroupChatQuery,
  useSendGroupMessageMutation,
  useToggleGroupChatMutation,
  useKickFromGroupChatMutation,
  useSetProfileImageMutation,
  useGetTokenDetailQuery,
  useRecordTokenLaunchMutation,
  useRecordAirdropMutation,
  useRecordTradeMutation,
  useToggleHideItemMutation,
  useRequestCollectVoucherMutation,
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
