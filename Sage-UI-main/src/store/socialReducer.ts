import { baseApi } from './baseReducer';

export interface SocialAuthor {
  address: string;
  username: string | null;
  profilePicture: string | null;
  pfpVerified: boolean;
  verified: boolean; // paid checkmark
  isAgent: boolean; // sage-mcp AI agent — see AgentBadge.tsx
}

export interface SocialPost {
  id: number;
  text: string;
  imageUrl: string | null;
  mediaType: 'image' | 'video' | null;
  createdAt: string;
  editedAt?: string | null;
  isPinned?: boolean;
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
  linkUrl: string | null;
  linkTitle: string | null;
  linkDesc: string | null;
  linkImage: string | null;
  dropId: number | null;
  dropKind: 'auction' | 'openEdition' | 'collection' | null;
  dropPrice: number | null;
  /** auction drops: id for reading on-chain state (timer starts at first bid) */
  dropAuctionId?: number | null;
  /** open editions: fixed end; auctions: DB fallback until chain state loads */
  dropEndTime?: string | null;
  author: SocialAuthor;
  likedByViewer: boolean;
  repostedByViewer: boolean;
  collectedByViewer: boolean;
  // quote-repost embed (one level deep; null if the quoted post was deleted)
  quotedPostId?: number | null;
  quoteCount: number;
  quoted?: QuotedPost | null;
}

export interface QuotedPost {
  id: number;
  text: string;
  imageUrl: string | null;
  mediaType: 'image' | 'video' | null;
  createdAt: string;
  author: {
    address: string;
    username: string | null;
    profilePicture: string | null;
    verified: boolean;
    isAgent: boolean;
  };
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
  isAgent: boolean; // sage-mcp AI agent — see AgentBadge.tsx
  bio: string | null;
  webpage: string | null;
  location: string | null;
  bannerImageS3Path: string | null;
  pinnedPostId: number | null;
  followers: number;
  following: number;
  postCount: number;
  followedByViewer: boolean;
  isSelf: boolean;
  needsInvite: boolean; // self only: composer should ask for an invite code
  unreadMessages: number; // self only
  unreadActivity: number; // self only — Twitter-style Activity-tab unread count (capped 99)
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

export interface TokenListItem {
  tokenAddress: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  description: string | null;
  createdAt: string;
  mcapUsd: number;
  creator: SocialUserCard;
}

export interface TokenHolding {
  tokenAddress: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  balance: number;
  pctOfSupply: number;
  valueUsd: number;
  mcapUsd: number;
}

export type Conversation = {
  partner: SocialUserCard;
  lastMessage: string;
  lastAt: string;
  unread: number;
};

export interface SocialUserCard {
  address: string;
  username: string | null;
  profilePicture?: string | null;
  verified: boolean;
  isAgent?: boolean; // sage-mcp AI agent — see AgentBadge.tsx
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
  // pixels/day — present only on the topPoints board, so the client can stream
  // the balance up live between refetches (see useLivePixels).
  rate?: number;
}

export interface Leaderboard {
  stats: {
    totalUsers: number;
    tokenVolumeEth: number;
    nftVolumeEth: number;
    nftVolumePixels: number;
  };
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
  user: SocialUserCard;
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
    bannerUrl: string | null;
    description: string | null;
    website: string | null;
    twitter: string | null;
    telegram: string | null;
    discord: string | null;
    airdropEnabled: boolean;
    creator: SocialUserCard;
  };
  priceEth: number;
  ethUsd: number;
  athPriceEth: number;
  price24hAgoEth: number;
  complete: boolean;
  uniswapPair: string | null;
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

export interface HashtagPage {
  tag: string;
  posts: SocialPost[];
  nextCursor: number | null;
}

export type FollowCard = SocialUserCard & { followedByViewer: boolean };
export interface FollowListPage {
  users: FollowCard[];
  nextCursor: string | null;
}

// Every cached endpoint whose payload can contain a SocialPost, in any shape:
// {posts: []} (feeds/profiles/hashtags/search), {replies: []} + {post} (a
// thread). A post the user can SEE came out of one of these caches, so a
// like/repost patch that skips any of them leaves that surface visually dead.
const POST_CACHE_ENDPOINTS = ['getFeed', 'getUserPosts', 'getHashtagFeed', 'searchSocial', 'getPostThread'];

// Patches EVERY currently-cached instance of the endpoints above, instead of
// a guessed set of query args. getFeed's global tab keys its cache on a fresh
// random `seed` per page load and paginated pages key on `cursor`, so a patch
// aimed at a fixed shape like {scope} silently misses the actual mounted
// query — that's why like/repost looked broken on the timeline. Likewise a
// patch aimed at getPostThread(likedPostId) misses a liked REPLY, which lives
// in the replies[] of its PARENT's thread cache — enumerating live cache
// entries is the only aim that can't miss.
function patchAllPostCaches(dispatch: any, getState: any, apply: (draft: any) => void) {
  const patches: { undo: () => void }[] = [];
  const queries = (getState() as any).api?.queries || {};
  for (const key in queries) {
    const q = queries[key];
    if (!q || !POST_CACHE_ENDPOINTS.includes(q.endpointName)) continue;
    patches.push(dispatch((socialApi.util.updateQueryData as any)(q.endpointName, q.originalArgs, apply)));
  }
  return patches;
}

// apply() for like/repost toggles: flip the post wherever it appears in this
// cache entry — feed/search page, thread root, or thread reply.
function flipEverywhere(draft: any, postId: number, flip: (p: SocialPost | undefined) => void) {
  flip(draft.posts?.find((x: SocialPost) => x.id === postId));
  flip(draft.replies?.find((x: SocialPost) => x.id === postId));
  if (draft.post?.id === postId) flip(draft.post);
}

const socialApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    // Infinite scroll: one cache entry PER SCOPE that pages merge into.
    // cursor=undefined replaces the list (fresh load / new post), a cursor
    // appends deduped older posts.
    getFeed: builder.query<FeedPage, { scope: Scope; cursor?: number; seed?: string }>({
      query: ({ scope, cursor, seed }) => ({
        url: `social?action=GetFeed&scope=${scope}${cursor ? `&cursor=${cursor}` : ''}${
          seed ? `&seed=${seed}` : ''
        }`,
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
        currentArg?.cursor !== previousArg?.cursor ||
        currentArg?.scope !== previousArg?.scope ||
        currentArg?.seed !== previousArg?.seed,
      providesTags: ['SocialFeed'],
    }),
    getUserPosts: builder.query<{ posts: SocialPost[] }, string>({
      query: (address) => ({ url: `social?action=GetUserPosts&address=${address}` }),
      providesTags: ['SocialFeed'],
    }),
    getPostThread: builder.query<{ post: SocialPost; replies: SocialPost[] }, number>({
      query: (id) => ({ url: `social?action=GetPost&id=${id}` }),
      // tag the replies too: a like on a reply invalidates SocialPost:<replyId>,
      // and if only the root were tagged that invalidation would match nothing
      // — the thread would never refetch and the reply's ♥ would stay frozen
      providesTags: (r, _e, id) => [
        { type: 'SocialPost' as const, id },
        ...(r?.replies || []).map((p) => ({ type: 'SocialPost' as const, id: p.id })),
      ],
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
    getBoostInfo: builder.query<
      {
        dailyMinUsd: number;
        dailyMaxUsd: number;
        daysMin: number;
        daysMax: number;
        ethUsd: number;
        treasury: string;
      },
      void
    >({
      query: () => ({ url: 'social?action=GetBoostInfo' }),
    }),
    getMyInvites: builder.query<{ invites: InviteCode[] }, void>({
      query: () => ({ url: 'social?action=GetMyInvites' }),
      providesTags: ['SocialProfile'],
    }),
    getInvitePreview: builder.query<InvitePreview, string>({
      query: (code) => ({ url: `social?action=GetInvite&code=${code}` }),
    }),
    getMyFollowing: builder.query<{ users: SocialUserCard[] }, void>({
      query: () => ({ url: 'social?action=GetMyFollowing' }),
      providesTags: ['SocialProfile'],
    }),
    getConversations: builder.query<{ conversations: Conversation[] }, void>({
      query: () => ({ url: 'social?action=GetConversations' }),
      providesTags: ['SocialMessages'],
    }),
    getMessages: builder.query<{ messages: DirectMessage[]; hasMore: boolean }, string>({
      query: (partner) => ({ url: `social?action=GetMessages&partner=${partner}` }),
      providesTags: ['SocialMessages'],
      // Opening a thread marks it read server-side. Reflect that instantly:
      // zero the conversation's unread pill (cache patch, no refetch) and
      // refresh the "Messages" nav badge (SocialProfile isn't a tag this query
      // provides, so invalidating it can't loop).
      async onQueryStarted(partner, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
        } catch {
          return;
        }
        dispatch(
          socialApi.util.updateQueryData('getConversations', undefined, (draft) => {
            const c = draft.conversations.find(
              (x) => x.partner.address.toLowerCase() === partner.toLowerCase()
            );
            if (c) c.unread = 0;
          })
        );
        dispatch(socialApi.util.invalidateTags(['SocialProfile']));
      },
    }),
    // Scroll-up pagination: fetch the page of messages older than `before`.
    // Kept separate from getMessages so loading history never re-marks read
    // and never clobbers the live (polled) latest-window cache.
    getOlderMessages: builder.query<
      { messages: DirectMessage[]; hasMore: boolean },
      { partner: string; before: number }
    >({
      query: ({ partner, before }) => ({
        url: `social?action=GetMessages&partner=${partner}&before=${before}`,
      }),
    }),
    getActivity: builder.query<{ activity: ActivityItem[] }, void>({
      query: () => ({ url: 'social?action=GetActivity' }),
      providesTags: ['SocialFeed'],
    }),
    // stamp "Activity opened" → resets the unread badge; invalidate the
    // profile so the nav re-fetches unreadActivity: 0
    markActivitySeen: builder.mutation<{ ok: boolean }, void>({
      query: () => ({ url: 'social?action=MarkActivitySeen', method: 'POST', body: {} }),
      invalidatesTags: ['SocialProfile'],
    }),
    getLeaderboardBoard: builder.query<
      { rows: LeaderboardRow[]; nextOffset: number | null },
      { board: string; offset?: number }
    >({
      query: ({ board, offset }) => ({
        url: `social?action=GetLeaderboardBoard&board=${board}${offset ? `&offset=${offset}` : ''}`,
      }),
      // one cache per board; offset pages append (same pattern as the feed)
      serializeQueryArgs: ({ queryArgs }) => `lb-${queryArgs.board}`,
      merge: (current, incoming, { arg }) => {
        if (!arg.offset) return incoming;
        current.rows.push(...incoming.rows);
        current.nextOffset = incoming.nextOffset;
        return current;
      },
      forceRefetch: ({ currentArg, previousArg }) =>
        currentArg?.offset !== previousArg?.offset || currentArg?.board !== previousArg?.board,
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
    // every creator coin this wallet holds a positive balance of — powers the
    // settings-page "your tokens" wallet view, next to the SAGE/pixel balances
    getMyTokenHoldings: builder.query<{ holdings: TokenHolding[] }, string>({
      query: (address) => ({ url: `social?action=GetMyTokenHoldings&address=${address}` }),
      providesTags: (_r, _e, address) => [{ type: 'SocialProfile', id: `holdings-${address}` }],
    }),
    // mcap-sorted board with infinite scroll: one cache entry, pages merge in
    getTokens: builder.query<
      { tokens: TokenListItem[]; nextCursor: number | null },
      { cursor?: number; q?: string } | void
    >({
      query: (args) => {
        const cursor = (args as any)?.cursor;
        const q = (args as any)?.q;
        return {
          url: `social?action=GetTokens${cursor ? `&cursor=${cursor}` : ''}${
            q ? `&q=${encodeURIComponent(q)}` : ''
          }`,
        };
      },
      // separate cache entry per search string, so switching between the
      // mcap-sorted board and a search doesn't clobber either's paging state
      serializeQueryArgs: ({ queryArgs }) => `tokens-board-${(queryArgs as any)?.q || ''}`,
      merge: (current, incoming, { arg }) => {
        if (!(arg as any)?.cursor) return incoming;
        const seen = new Set(current.tokens.map((t) => t.tokenAddress));
        current.tokens.push(...incoming.tokens.filter((t) => !seen.has(t.tokenAddress)));
        current.nextCursor = incoming.nextCursor;
        return current;
      },
      forceRefetch: ({ currentArg, previousArg }) =>
        (currentArg as any)?.cursor !== (previousArg as any)?.cursor ||
        (currentArg as any)?.q !== (previousArg as any)?.q,
      // was tagged 'SocialFeed' — a copy-paste leftover that nothing
      // matching actually invalidated, so a fresh launch never showed up
      // on the board without a manual reload
      providesTags: ['SocialTokenBoard'],
    }),
    getTokenTradesPage: builder.query<
      { trades: TokenTrade[]; nextOffset: number | null },
      { address: string; offset?: number }
    >({
      query: ({ address, offset }) => ({
        url: `social?action=GetTokenTradesPage&address=${address}${offset ? `&offset=${offset}` : ''}`,
      }),
      serializeQueryArgs: ({ queryArgs }) => `tok-trades-${queryArgs.address}`,
      merge: (current, incoming, { arg }) => {
        if (!arg.offset) return incoming;
        current.trades.push(...incoming.trades);
        current.nextOffset = incoming.nextOffset;
        return current;
      },
      forceRefetch: ({ currentArg, previousArg }) => currentArg?.offset !== previousArg?.offset,
      providesTags: (_r, _e, arg) => [{ type: 'SocialProfile', id: `tok-${arg.address}` }],
    }),
    getTokenHoldersPage: builder.query<
      { holders: TokenHolder[]; nextOffset: number | null },
      { address: string; offset?: number }
    >({
      query: ({ address, offset }) => ({
        url: `social?action=GetTokenHoldersPage&address=${address}${offset ? `&offset=${offset}` : ''}`,
      }),
      serializeQueryArgs: ({ queryArgs }) => `tok-holders-${queryArgs.address}`,
      merge: (current, incoming, { arg }) => {
        if (!arg.offset) return incoming;
        current.holders.push(...incoming.holders);
        current.nextOffset = incoming.nextOffset;
        return current;
      },
      forceRefetch: ({ currentArg, previousArg }) => currentArg?.offset !== previousArg?.offset,
      providesTags: (_r, _e, arg) => [{ type: 'SocialProfile', id: `tok-${arg.address}` }],
    }),
    getTokenDetail: builder.query<TokenDetail, string>({
      query: (address) => ({ url: `social?action=GetTokenDetail&address=${address}` }),
      providesTags: (_r, _e, address) => [{ type: 'SocialProfile', id: `tok-${address}` }],
    }),
    searchSocial: builder.query<{ users: SocialUserCard[]; posts: SocialPost[] }, string>({
      query: (q) => ({ url: `social?action=Search&q=${encodeURIComponent(q)}` }),
    }),
    createDropPost: builder.mutation<{ post: SocialPost }, { dropId: number; kind: string }>({
      query: (body) => ({ url: 'social?action=CreateDropPost', method: 'POST', body }),
      invalidatesTags: ['SocialFeed'],
    }),
    createPost: builder.mutation<
      { post: SocialPost },
      {
        text: string;
        imageUrl?: string;
        mediaType?: 'image' | 'video';
        replyToId?: number;
        quotedPostId?: number;
      }
    >({
      query: (body) => ({ url: 'social?action=CreatePost', method: 'POST', body }),
      // Your new post shows at the TOP of the feed immediately: patch the
      // cached feed pages instead of refetching (a hot-ranked refetch would
      // bury a brand-new post with zero engagement).
      async onQueryStarted(arg, { dispatch, queryFulfilled }) {
        let created: SocialPost | undefined;
        try {
          created = (await queryFulfilled).data.post;
        } catch {
          return;
        }
        if (!created || arg.replyToId) return;
        (['global', 'following', 'latest'] as Scope[]).forEach((scope) =>
          dispatch(
            socialApi.util.updateQueryData('getFeed', { scope }, (draft) => {
              if (!draft.posts.some((p) => p.id === created!.id)) draft.posts.unshift(created!);
            })
          )
        );
        // your PROFILE page shows getUserPosts — patch it too so the new post
        // is there the instant you land on it (no 30s-later refresh)
        dispatch(
          socialApi.util.updateQueryData('getUserPosts', created.author.address, (draft) => {
            if (!draft.posts.some((p) => p.id === created!.id)) draft.posts.unshift(created!);
          })
        );
      },
      // refetches are SAFE to fire now — the server pins your fresh posts to
      // the top of page 1, so a refetch can't bury what the patch just added
      invalidatesTags: (_r, _e, arg) =>
        arg.replyToId ? [{ type: 'SocialPost', id: arg.replyToId }, 'SocialFeed'] : ['SocialFeed'],
    }),
    toggleLike: builder.mutation<{ liked: boolean }, number>({
      query: (postId) => ({ url: 'social?action=ToggleLike', method: 'POST', body: { postId } }),
      // optimistic: paginated feed pages beyond the newest are append-only in
      // the cache, so patch them directly instead of waiting for a refetch
      async onQueryStarted(postId, { dispatch, getState, queryFulfilled }) {
        const flip = (p: SocialPost | undefined) => {
          if (!p) return;
          p.likedByViewer = !p.likedByViewer;
          p.likeCount += p.likedByViewer ? 1 : -1;
        };
        const patches = patchAllPostCaches(dispatch, getState, (draft: any) =>
          flipEverywhere(draft, postId, flip)
        );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
      invalidatesTags: (_r, _e, postId) => ['SocialFeed', { type: 'SocialPost', id: postId }],
    }),
    toggleRepost: builder.mutation<{ reposted: boolean }, number>({
      query: (postId) => ({ url: 'social?action=ToggleRepost', method: 'POST', body: { postId } }),
      async onQueryStarted(postId, { dispatch, getState, queryFulfilled }) {
        const flip = (p: SocialPost | undefined) => {
          if (!p) return;
          p.repostedByViewer = !p.repostedByViewer;
          p.repostCount += p.repostedByViewer ? 1 : -1;
        };
        const patches = patchAllPostCaches(dispatch, getState, (draft: any) =>
          flipEverywhere(draft, postId, flip)
        );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
      invalidatesTags: (_r, _e, postId) => ['SocialFeed', { type: 'SocialPost', id: postId }],
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
      { ok: boolean; amount: number; boostedUntil: string; days: number },
      { postId: number; txHash: string; dailyUsd: number; days: number }
    >({
      query: (body) => ({ url: 'social?action=BoostPost', method: 'POST', body }),
      invalidatesTags: ['SocialFeed'],
    }),
    setCollectible: builder.mutation<
      { ok: boolean; collectPrice: number | null; collectCurrency: string },
      { postId: number; price: number | null; currency?: 'ETH' | 'POINTS' }
    >({
      query: (body) => ({ url: 'social?action=SetCollectible', method: 'POST', body }),
      invalidatesTags: (_r, _e, arg) => [{ type: 'SocialPost', id: arg.postId }, 'SocialFeed'],
    }),
    collectPost: builder.mutation<
      {
        ok: boolean;
        // legacy server-mint response…
        tokenId?: number;
        mintTxHash?: string;
        pointsSpent: string | null;
        // …or voucher mode: the collector redeems this themselves (their gas)
        voucher?: { postId: number; uri: string; signature: string };
        minter?: string;
        resumed?: boolean;
      },
      { postId: number; txHash?: string; payWith?: 'SAGE' | 'POINTS' }
    >({
      query: (body) => ({ url: 'social?action=CollectPost', method: 'POST', body }),
      invalidatesTags: (_r, _e, arg) => [{ type: 'SocialPost', id: arg.postId }, 'SocialFeed'],
    }),
    confirmCollectMint: builder.mutation<
      { ok: boolean; tokenId: number | null; already?: boolean },
      { postId: number; txHash: string }
    >({
      query: (body) => ({ url: 'social?action=ConfirmCollectMint', method: 'POST', body }),
      invalidatesTags: (_r, _e, arg) => [{ type: 'SocialPost', id: arg.postId }],
    }),
    updateTokenInfo: builder.mutation<
      {
        ok: boolean;
        website: string | null;
        twitter: string | null;
        telegram: string | null;
        discord: string | null;
        description: string | null;
      },
      {
        tokenAddress: string;
        website?: string;
        twitter?: string;
        telegram?: string;
        discord?: string;
        description?: string;
      }
    >({
      query: (body) => ({ url: 'social?action=UpdateTokenInfo', method: 'POST', body }),
      // repaint the token page with the fresh links on success
      async onQueryStarted(arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            socialApi.util.updateQueryData('getTokenDetail', arg.tokenAddress, (draft) => {
              draft.token.website = data.website;
              draft.token.twitter = data.twitter;
              draft.token.telegram = data.telegram;
              draft.token.discord = data.discord;
              draft.token.description = data.description;
            })
          );
        } catch {
          /* server rejected — nothing to patch */
        }
      },
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
    editPost: builder.mutation<{ post: SocialPost }, { postId: number; text: string }>({
      query: (body) => ({ url: 'social?action=EditPost', method: 'POST', body }),
      async onQueryStarted({ postId }, { dispatch, queryFulfilled }) {
        // paint the server's post (fresh link card + editedAt) into both feeds
        try {
          const { data } = await queryFulfilled;
          (['global', 'following'] as const).forEach((scope) =>
            dispatch(
              socialApi.util.updateQueryData('getFeed', { scope }, (draft) => {
                const i = draft.posts.findIndex((x) => x.id === postId);
                if (i >= 0) draft.posts[i] = { ...draft.posts[i], ...data.post };
              })
            )
          );
        } catch {}
      },
      invalidatesTags: ['SocialProfile'],
    }),
    // postId omitted → unpin
    pinPost: builder.mutation<{ ok: boolean; pinnedPostId: number | null }, { postId?: number }>({
      query: (body) => ({ url: 'social?action=PinPost', method: 'POST', body }),
      // 'SocialFeed' covers getUserPosts (the per-post isPinned flag the
      // profile actually renders) — 'SocialProfile' alone only refreshes the
      // header (pinnedPostId), leaving the stale badge until a manual reload.
      invalidatesTags: ['SocialProfile', 'SocialFeed'],
    }),
    // admin-only platform takedown/restore — see banUser() in social.page.ts
    banUser: builder.mutation<
      { ok: boolean; banned: boolean },
      { address: string; reason?: string; unban?: boolean }
    >({
      query: (body) => ({ url: 'social?action=BanUser', method: 'POST', body }),
      invalidatesTags: ['SocialProfile', 'SocialFeed'],
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
        bannerUrl?: string;
        airdropEnabled?: boolean;
        description?: string;
        website?: string;
      }
    >({
      query: (body) => ({ url: 'social?action=RecordTokenLaunch', method: 'POST', body }),
      invalidatesTags: ['SocialProfile', 'SocialTokenBoard'],
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
      {
        tokenAddress: string;
        side: 'buy' | 'sell';
        txHash: string;
        // client-known extras for the INSTANT optimistic paint (not sent to
        // the server): what you traded and who you are
        ethAmount?: number;
        tokenAmount?: number;
        trader?: string;
      }
    >({
      query: ({ tokenAddress, side, txHash }) => ({
        url: 'social?action=RecordTrade',
        method: 'POST',
        body: { tokenAddress, side, txHash },
      }),
      // The trade shows up the INSTANT the wallet tx confirms: paint a
      // provisional row into the token page cache, then the invalidation
      // refetch replaces it with the server's decoded truth.
      async onQueryStarted(arg, { dispatch, queryFulfilled }) {
        let patch: { undo: () => void } | undefined;
        if (arg.ethAmount !== undefined || arg.tokenAmount !== undefined) {
          patch = dispatch(
            socialApi.util.updateQueryData('getTokenDetail', arg.tokenAddress, (draft) => {
              draft.trades.unshift({
                side: arg.side,
                trader: arg.trader || '',
                // real user card arrives on the invalidation refetch right
                // after — this optimistic row just needs the address to show
                user: { address: arg.trader || '', username: null, profilePicture: null, verified: false },
                ethAmount: arg.ethAmount || 0,
                tokenAmount: arg.tokenAmount || 0,
                createdAt: new Date().toISOString(),
              });
              draft.tradeCount += 1;
            })
          );
        }
        try {
          await queryFulfilled;
        } catch {
          patch?.undo();
        }
      },
      // also refresh the board (mcap/rank moved) and the trader's own wallet
      // holdings view, if we know who they are
      invalidatesTags: (_r, _e, arg) => [
        { type: 'SocialProfile', id: `tok-${arg.tokenAddress}` },
        'SocialTokenBoard',
        ...(arg.trader ? [{ type: 'SocialProfile' as const, id: `holdings-${arg.trader}` }] : []),
      ],
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
      { url: string; kind: 'avatar' | 'banner'; address?: string }
    >({
      query: ({ url, kind }) => ({
        url: 'social?action=SetProfileImage',
        method: 'POST',
        body: { url, kind },
      }),
      // Patch the profile cache immediately so the new avatar/banner shows the
      // instant the upload resolves — no waiting on the invalidation refetch.
      async onQueryStarted({ url, kind, address }, { dispatch, queryFulfilled }) {
        if (!address) return;
        const patch = dispatch(
          socialApi.util.updateQueryData('getSocialProfile', address, (draft) => {
            if (kind === 'banner') draft.bannerImageS3Path = url;
            else {
              draft.profilePicture = url;
              draft.pfpVerified = false; // custom avatar clears the NFT ring
            }
          })
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
      invalidatesTags: ['SocialProfile', 'SocialFeed', 'User'],
    }),
    requestCollectVoucher: builder.mutation<
      CollectVoucher,
      { postId: number; txHash?: string; payWith?: 'SAGE' | 'POINTS' }
    >({
      query: (body) => ({ url: 'social?action=RequestCollectVoucher', method: 'POST', body }),
      invalidatesTags: (_r, _e, arg) => [{ type: 'SocialPost', id: arg.postId }, 'SocialFeed'],
    }),
    requestFaucetVoucher: builder.mutation<{ signature: string }, void>({
      query: () => ({ url: 'social?action=RequestFaucetVoucher', method: 'POST' }),
    }),

    // ─────────── followers / following lists ───────────
    getFollowers: builder.query<FollowListPage, { address: string; cursor?: string }>({
      query: ({ address, cursor }) => ({
        url: `social?action=GetFollowers&address=${address}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      }),
      serializeQueryArgs: ({ queryArgs }) => `followers-${queryArgs.address}`,
      merge: (current, incoming, { arg }) => {
        if (!arg.cursor) return incoming;
        const seen = new Set(current.users.map((u) => u.address));
        current.users.push(...incoming.users.filter((u) => !seen.has(u.address)));
        current.nextCursor = incoming.nextCursor;
        return current;
      },
      forceRefetch: ({ currentArg, previousArg }) => currentArg?.cursor !== previousArg?.cursor,
    }),
    getFollowing: builder.query<FollowListPage, { address: string; cursor?: string }>({
      query: ({ address, cursor }) => ({
        url: `social?action=GetFollowing&address=${address}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      }),
      serializeQueryArgs: ({ queryArgs }) => `following-${queryArgs.address}`,
      merge: (current, incoming, { arg }) => {
        if (!arg.cursor) return incoming;
        const seen = new Set(current.users.map((u) => u.address));
        current.users.push(...incoming.users.filter((u) => !seen.has(u.address)));
        current.nextCursor = incoming.nextCursor;
        return current;
      },
      forceRefetch: ({ currentArg, previousArg }) => currentArg?.cursor !== previousArg?.cursor,
    }),

    // ─────────── hashtags ───────────
    getHashtagFeed: builder.query<HashtagPage, { tag: string; cursor?: number }>({
      query: ({ tag, cursor }) => ({
        url: `social?action=GetHashtagFeed&tag=${encodeURIComponent(tag)}${cursor ? `&cursor=${cursor}` : ''}`,
      }),
      serializeQueryArgs: ({ queryArgs }) => `hashtag-${queryArgs.tag}`,
      merge: (current, incoming, { arg }) => {
        if (!arg.cursor) return incoming;
        const seen = new Set(current.posts.map((p) => p.id));
        current.posts.push(...incoming.posts.filter((p) => !seen.has(p.id)));
        current.nextCursor = incoming.nextCursor;
        return current;
      },
      forceRefetch: ({ currentArg, previousArg }) => currentArg?.cursor !== previousArg?.cursor,
      providesTags: ['SocialFeed'],
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
  useGetMyFollowingQuery,
  useGetConversationsQuery,
  useGetMessagesQuery,
  useLazyGetOlderMessagesQuery,
  useGetActivityQuery,
  useMarkActivitySeenMutation,
  useGetLeaderboardQuery,
  useGetLeaderboardBoardQuery,
  useGetUserMintsQuery,
  useGetGlobalActivityQuery,
  useGetProfileTokenQuery,
  useGetMyTokenHoldingsQuery,
  useSearchSocialQuery,
  useDeletePostMutation,
  useEditPostMutation,
  usePinPostMutation,
  useBanUserMutation,
  useGetGroupChatQuery,
  useSendGroupMessageMutation,
  useToggleGroupChatMutation,
  useKickFromGroupChatMutation,
  useSetProfileImageMutation,
  useGetTokensQuery,
  useGetTokenDetailQuery,
  useGetTokenTradesPageQuery,
  useGetTokenHoldersPageQuery,
  useRecordTokenLaunchMutation,
  useRecordAirdropMutation,
  useRecordTradeMutation,
  useToggleHideItemMutation,
  useRequestCollectVoucherMutation,
  useRequestFaucetVoucherMutation,
  useCreatePostMutation,
  useCreateDropPostMutation,
  useToggleLikeMutation,
  useToggleRepostMutation,
  useToggleFollowMutation,
  useRecordTipMutation,
  useBoostPostMutation,
  useSetCollectibleMutation,
  useCollectPostMutation,
  useConfirmCollectMintMutation,
  useUpdateTokenInfoMutation,
  useSetNftPfpMutation,
  useSetFollowGateMutation,
  usePurchaseVerificationMutation,
  useRedeemInviteMutation,
  useSendMessageMutation,
  // new social features
  useGetFollowersQuery,
  useGetFollowingQuery,
  useGetHashtagFeedQuery,
} = socialApi;
