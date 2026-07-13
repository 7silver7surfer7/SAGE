import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import LoaderDots from '@/components/LoaderDots';
import PostCard from '@/components/Social/PostCard';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import {
  useGetSocialProfileQuery,
  useGetUserPostsQuery,
  useToggleFollowMutation,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

export default function SocialProfilePage() {
  const router = useRouter();
  const address = (router.query.address as string) || '';
  const { isSignedIn } = useSAGEAccount();
  const { data: profile, isFetching: loadingProfile } = useGetSocialProfileQuery(address, {
    skip: !address,
  });
  const { data: postsData, isFetching: loadingPosts } = useGetUserPostsQuery(address, {
    skip: !address,
  });
  const [toggleFollow, { isLoading: following }] = useToggleFollowMutation();

  if (loadingProfile || !profile) return <LoaderDots />;

  const displayName = profile.username
    ? transformTitle(profile.username)
    : shortenAddress(profile.address);

  const onFollow = async () => {
    if (!isSignedIn) {
      toast.info('Connect your wallet to follow');
      return;
    }
    try {
      await toggleFollow(profile.address).unwrap();
    } catch (e: any) {
      toast.error(e?.data?.error || 'Could not follow');
    }
  };

  return (
    <div className='social social--profile'>
      <div className='social-profile__banner'>
        {profile.bannerImageS3Path && <PfpImage src={profile.bannerImageS3Path} />}
      </div>
      <div className='social-profile__head'>
        <div className='social-profile__avatar'>
          <PfpImage src={profile.profilePicture} />
        </div>
        {!profile.isSelf && (
          <button
            className={`social-profile__follow ${profile.followedByViewer ? 'social-profile__follow--on' : ''}`}
            disabled={following}
            onClick={onFollow}
          >
            {profile.followedByViewer ? 'Following' : 'Follow'}
          </button>
        )}
      </div>
      <div className='social-profile__info'>
        <h1 className='social-profile__name'>{displayName}</h1>
        <span className='social-profile__handle'>{shortenAddress(profile.address)}</span>
        {profile.bio && <p className='social-profile__bio'>{profile.bio}</p>}
        <div className='social-profile__stats'>
          <span>
            <b>{profile.postCount}</b> posts
          </span>
          <span>
            <b>{profile.following}</b> following
          </span>
          <span>
            <b>{profile.followers}</b> followers
          </span>
        </div>
      </div>

      <div className='social__feed'>
        {loadingPosts && !postsData ? (
          <LoaderDots />
        ) : postsData?.posts.length ? (
          postsData.posts.map((p) => <PostCard key={p.id} post={p} />)
        ) : (
          <div className='social__empty'>No posts yet.</div>
        )}
      </div>
    </div>
  );
}
