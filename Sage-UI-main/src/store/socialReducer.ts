import { baseApi } from './baseReducer';

export interface SocialAuthor {
  address: string;
  username: string | null;
  profilePicture: string | null;
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
  author: SocialAuthor;
  likedByViewer: boolean;
  repostedByViewer: boolean;
}

export interface SocialProfile {
  address: string;
  username: string | null;
  profilePicture: string | null;
  bio: string | null;
  bannerImageS3Path: string | null;
  followers: number;
  following: number;
  postCount: number;
  followedByViewer: boolean;
  isSelf: boolean;
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
    toggleFollow: builder.mutation<{ following: boolean }, string>({
      query: (address) => ({ url: 'social?action=ToggleFollow', method: 'POST', body: { address } }),
      invalidatesTags: (_r, _e, address) => [{ type: 'SocialProfile', id: address }, 'SocialFeed'],
    }),
    recordTip: builder.mutation<
      { ok: boolean },
      { postId: number; toAddress: string; amount: number; txHash: string }
    >({
      query: (body) => ({ url: 'social?action=RecordTip', method: 'POST', body }),
      invalidatesTags: ['SocialFeed'],
    }),
  }),
});

export const {
  useGetFeedQuery,
  useGetUserPostsQuery,
  useGetPostThreadQuery,
  useGetSocialProfileQuery,
  useCreatePostMutation,
  useToggleLikeMutation,
  useToggleRepostMutation,
  useToggleFollowMutation,
  useRecordTipMutation,
} = socialApi;
