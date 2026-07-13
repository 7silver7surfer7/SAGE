import { useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import LoaderDots from '@/components/LoaderDots';
import PostCard from '@/components/Social/PostCard';
import SocialShell from '@/components/Social/SocialShell';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import VerificationModal from '@/components/Social/VerificationModal';
import ReferCard from '@/components/Social/ReferCard';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import {
  useGetSocialProfileQuery,
  useGetUserPostsQuery,
  useGetUserMintsQuery,
  useGetOwnedNftsQuery,
  useToggleFollowMutation,
  useSetNftPfpMutation,
  useSetFollowGateMutation,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

/** Grid of the viewer's own NFTs — pick one to become the NFT avatar. */
function NftPfpPicker({ onClose }: { onClose: () => void }) {
  const { data, isFetching } = useGetOwnedNftsQuery();
  const [setNftPfp, { isLoading: saving }] = useSetNftPfpMutation();
  const pick = async (nftId: number) => {
    try {
      await setNftPfp(nftId).unwrap();
      toast.success('NFT avatar set ⬡');
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

/** Grid of post-NFTs this wallet collected. */
function MintsGrid({ address }: { address: string }) {
  const router = useRouter();
  const { data, isFetching } = useGetUserMintsQuery(address);
  if (isFetching && !data) return <LoaderDots />;
  if (!data?.mints.length)
    return <div className='social__empty'>No collected posts yet.</div>;
  return (
    <div className='social-mints'>
      {data.mints.map((m) => (
        <div
          key={`${m.contractAddress}-${m.tokenId}`}
          className='social-mints__card'
          onClick={() => router.push(`/social/post/${m.post.id}`)}
        >
          {m.post.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.post.imageUrl} alt='' />
          ) : (
            <p className='social-mints__text'>{m.post.text}</p>
          )}
          <div className='social-mints__meta'>
            <span>SAGE Social #{m.post.id}</span>
            <span className='social-mints__token'>token {m.tokenId}</span>
          </div>
          <div className='social-mints__paid'>
            {m.pointsSpent ? `${m.pointsSpent} pixels` : m.amount > 0 ? `${m.amount} SAGE` : 'free'}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SocialProfilePage() {
  const router = useRouter();
  const address = (router.query.address as string) || '';
  const { isSignedIn } = useSAGEAccount();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [tab, setTab] = useState<'posts' | 'mints'>('posts');
  const { data: profile, isFetching: loadingProfile } = useGetSocialProfileQuery(address, {
    skip: !address,
  });
  const { data: postsData, isFetching: loadingPosts } = useGetUserPostsQuery(address, {
    skip: !address,
  });
  const [toggleFollow, { isLoading: following }] = useToggleFollowMutation();
  const [setFollowGate, { isLoading: gating }] = useSetFollowGateMutation();

  if (loadingProfile || !profile)
    return (
      <SocialShell>
        <LoaderDots />
      </SocialShell>
    );

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
    <SocialShell>
    <div className='social social--profile'>
      <div className='social-profile__banner'>
        {profile.bannerImageS3Path && <PfpImage src={profile.bannerImageS3Path} />}
      </div>
      <div className='social-profile__head'>
        <div className='social-profile__avatar' data-verified={profile.pfpVerified}>
          <PfpImage src={profile.profilePicture} />
        </div>
        <div className='social-profile__cta'>
          {profile.isSelf ? (
            <>
              {!profile.verified && (
                <button className='social-profile__follow' onClick={() => setVerifyOpen(true)}>
                  Get verified
                </button>
              )}
              <button
                className='social-profile__follow social-profile__follow--on'
                onClick={() => setPickerOpen(true)}
              >
                {profile.pfpVerified ? 'Change NFT avatar' : 'Use an NFT as avatar'}
              </button>
            </>
          ) : (
            <>
              <button
                className='social-profile__follow social-profile__follow--on'
                onClick={() => router.push(`/social/messages/?to=${profile.address}`)}
              >
                Message
              </button>
              <button
                className={`social-profile__follow ${profile.followedByViewer ? 'social-profile__follow--on' : ''}`}
                disabled={following}
                onClick={onFollow}
              >
                {profile.followedByViewer ? 'Following' : 'Follow'}
              </button>
            </>
          )}
        </div>
      </div>
      <div className='social-profile__info'>
        <h1 className='social-profile__name'>
          {displayName}
          {profile.verified && <VerifiedBadge size={18} />}
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
        {profile.isSelf && <ReferCard />}
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
      {verifyOpen && <VerificationModal onClose={() => setVerifyOpen(false)} />}

      <div className='social__tabs'>
        <button
          className={`social__tab ${tab === 'posts' ? 'social__tab--active' : ''}`}
          onClick={() => setTab('posts')}
        >
          Posts
        </button>
        <button
          className={`social__tab ${tab === 'mints' ? 'social__tab--active' : ''}`}
          onClick={() => setTab('mints')}
        >
          Mints
        </button>
      </div>
      {tab === 'mints' ? (
        <MintsGrid address={profile.address} />
      ) : (
        <div className='social__feed'>
          {loadingPosts && !postsData ? (
            <LoaderDots />
          ) : postsData?.posts.length ? (
            postsData.posts.map((p) => <PostCard key={p.id} post={p} />)
          ) : (
            <div className='social__empty'>No posts yet.</div>
          )}
        </div>
      )}
    </div>
    </SocialShell>
  );
}
