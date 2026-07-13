import { useState } from 'react';
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
  useGetOwnedNftsQuery,
  useToggleFollowMutation,
  useSetNftPfpMutation,
  useSetFollowGateMutation,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

const VerifiedBadge = () => (
  <svg width='18' height='18' viewBox='0 0 24 24' fill='#d4fc52' style={{ marginLeft: 6 }}>
    <path d='M12 1l2.7 2 3.3-.4 1.2 3.1 3 1.5-.7 3.3L23 13l-2.3 2.4.4 3.3-3.1 1.2-1.5 3-3.3-.7L11 23l-2.4-2.3-3.3.4-1.2-3.1-3-1.5.7-3.3L1 11l2.3-2.4L2.9 5.3 6 4.1l1.5-3 3.3.7L12 1z' />
    <path d='M8 12.5l2.6 2.6L16.4 9' stroke='#131917' strokeWidth='2.4' fill='none' />
  </svg>
);

/** Grid of the viewer's own NFTs — pick one to become the verified avatar. */
function NftPfpPicker({ onClose }: { onClose: () => void }) {
  const { data, isFetching } = useGetOwnedNftsQuery();
  const [setNftPfp, { isLoading: saving }] = useSetNftPfpMutation();
  const pick = async (nftId: number) => {
    try {
      await setNftPfp(nftId).unwrap();
      toast.success('Verified NFT avatar set ⬡');
      onClose();
    } catch (e: any) {
      toast.error(e?.data?.error || 'Could not set avatar');
    }
  };
  return (
    <div className='social-pfp-picker' onClick={(e) => e.stopPropagation()}>
      <div className='social-pfp-picker__head'>
        <h3>Pick an NFT you own</h3>
        <button className='social-pfp-picker__close' onClick={onClose}>
          ✕
        </button>
      </div>
      {isFetching ? (
        <LoaderDots />
      ) : data?.nfts.length ? (
        <div className='social-pfp-picker__grid'>
          {data.nfts.map((n) => (
            <button
              key={n.id}
              className='social-pfp-picker__item'
              disabled={saving}
              onClick={() => pick(n.id)}
              title={n.name}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={n.s3PathOptimized || n.s3Path} alt={n.name} />
              <span>{n.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className='social-pfp-picker__empty'>
          No SAGE NFTs in this wallet yet — mint or buy one and it shows up here.
        </p>
      )}
    </div>
  );
}

export default function SocialProfilePage() {
  const router = useRouter();
  const address = (router.query.address as string) || '';
  const { isSignedIn } = useSAGEAccount();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: profile, isFetching: loadingProfile } = useGetSocialProfileQuery(address, {
    skip: !address,
  });
  const { data: postsData, isFetching: loadingPosts } = useGetUserPostsQuery(address, {
    skip: !address,
  });
  const [toggleFollow, { isLoading: following }] = useToggleFollowMutation();
  const [setFollowGate, { isLoading: gating }] = useSetFollowGateMutation();

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
      const r = await toggleFollow(profile.address).unwrap();
      if (r.following && r.whitelistedFor?.length) {
        toast.success(`You're on the allowlist for: ${r.whitelistedFor.join(', ')} 🎟️`);
      }
    } catch (e: any) {
      toast.error(e?.data?.error || 'Could not follow');
    }
  };

  const onToggleGate = async (dropId: number, enabled: boolean) => {
    try {
      const r = await setFollowGate({ dropId, enabled }).unwrap();
      toast.success(
        enabled
          ? `Follow gate ON${r.backfilled ? ` — ${r.backfilled} existing followers allowlisted` : ''}`
          : 'Follow gate off'
      );
    } catch (e: any) {
      toast.error(e?.data?.error || 'Could not update follow gate');
    }
  };

  return (
    <div className='social social--profile'>
      <div className='social-profile__banner'>
        {profile.bannerImageS3Path && <PfpImage src={profile.bannerImageS3Path} />}
      </div>
      <div className='social-profile__head'>
        <div className='social-profile__avatar' data-verified={profile.pfpVerified}>
          <PfpImage src={profile.profilePicture} />
        </div>
        {profile.isSelf ? (
          <button className='social-profile__follow' onClick={() => setPickerOpen(true)}>
            {profile.pfpVerified ? 'Change NFT avatar' : 'Use an NFT as avatar'}
          </button>
        ) : (
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
        <h1 className='social-profile__name'>
          {displayName}
          {profile.pfpVerified && <VerifiedBadge />}
        </h1>
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
        {profile.followGatedDrops.length > 0 && !profile.isSelf && (
          <div className='social-profile__gate-banner'>
            🎟️ Following {displayName} gets you on the allowlist for:{' '}
            <b>{profile.followGatedDrops.map((d) => d.name).join(', ')}</b>
          </div>
        )}
        {profile.isSelf && profile.myDrops.length > 0 && (
          <div className='social-profile__gates'>
            <h4>Follow-to-allowlist</h4>
            <p>Turn a drop on and everyone who follows you gets an allowlist spot for it.</p>
            {profile.myDrops.map((d) => (
              <label key={d.id} className='social-profile__gate-row'>
                <input
                  type='checkbox'
                  disabled={gating}
                  checked={!!d.followGateEnabled}
                  onChange={(e) => onToggleGate(d.id, e.target.checked)}
                />
                {d.name}
              </label>
            ))}
          </div>
        )}
      </div>

      {pickerOpen && (
        <div className='social-pfp-picker__overlay' onClick={() => setPickerOpen(false)}>
          <NftPfpPicker onClose={() => setPickerOpen(false)} />
        </div>
      )}

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
