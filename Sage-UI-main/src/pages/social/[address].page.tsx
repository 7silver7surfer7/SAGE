import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import LoaderDots from '@/components/LoaderDots';
import PostCard from '@/components/Social/PostCard';
import SocialShell from '@/components/Social/SocialShell';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import VerificationModal from '@/components/Social/VerificationModal';
import ReferCard from '@/components/Social/ReferCard';
import EditProfileModal from '@/components/Social/EditProfileModal';
import MediaCropModal from '@/components/Social/MediaCropModal';
import TokenPanel from '@/components/Social/TokenPanel';
import EditionPanel from '@/components/Social/EditionPanel';
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
  useSetProfileImageMutation,
  useToggleHideItemMutation,
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

/** Grid of every NFT this wallet holds — posts it collected AND any SAGE NFT
 * it owns (minted or acquired elsewhere). Owner can hide items. */
function MintsGrid({ address, isSelf }: { address: string; isSelf: boolean }) {
  const router = useRouter();
  const { data, isFetching } = useGetUserMintsQuery(address);
  const [hide] = useToggleHideItemMutation();
  if (isFetching && !data) return <LoaderDots />;
  if (!data?.mints.length)
    return <div className='social__empty'>No NFTs yet — collect a post or mint an edition.</div>;
  const onHide = async (e: React.MouseEvent, ref: string) => {
    e.stopPropagation();
    try {
      await hide({ kind: 'nft', ref, hide: true }).unwrap();
      toast.success('Hidden from your profile');
    } catch {
      toast.error('Could not hide');
    }
  };
  return (
    <div className='social-mints'>
      {data.mints.map((m) => {
        const img = m.image || m.post?.imageUrl || null;
        const go = () => (m.post ? router.push(`/social/post/${m.post.id}`) : undefined);
        return (
          <div key={m.ref} className='social-mints__card' onClick={go}>
            {isSelf && (
              <button className='social-mints__hide' title='Hide from profile' onClick={(e) => onHide(e, m.ref)}>
                hide
              </button>
            )}
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt='' />
            ) : (
              <p className='social-mints__text'>{m.post?.text || m.title}</p>
            )}
            <div className='social-mints__meta'>
              <span>{m.title}</span>
              <span className='social-mints__token'>#{m.tokenId}</span>
            </div>
            <div className='social-mints__paid'>
              {m.source === 'owned' ? 'owned' : m.pointsSpent ? `${m.pointsSpent} pixels` : 'collected'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function SocialProfilePage() {
  const router = useRouter();
  const address = (router.query.address as string) || '';
  const { isSignedIn, userData } = useSAGEAccount();
  const viewerVerified =
    !!(userData as any)?.verifiedAt;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<'posts' | 'mints'>('posts');
  // deep-link support: /social/<addr>?tab=mints opens the Mints tab (used by
  // the "My mints" sidebar link)
  useEffect(() => {
    const q = router.query.tab;
    if (q === 'mints' || q === 'posts') setTab(q);
  }, [router.query.tab]);
  const { data: profile, isFetching: loadingProfile, error: profileError, refetch: refetchProfile } =
    useGetSocialProfileQuery(address, { skip: !address });
  const { data: postsData, isFetching: loadingPosts } = useGetUserPostsQuery(address, {
    skip: !address,
  });
  const [toggleFollow, { isLoading: following }] = useToggleFollowMutation();
  const [setFollowGate, { isLoading: gating }] = useSetFollowGateMutation();
  const [setProfileImage] = useSetProfileImageMutation();
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const bannerFileRef = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState<{ kind: 'avatar' | 'banner'; file: File } | null>(null);

  // upload + compress (server-side crop per kind), then attach to the profile
  const onImageFile = async (kind: 'avatar' | 'banner', file?: File) => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      toast.error('Images are capped at 12MB');
      return;
    }
    const t = toast.loading(`Uploading ${kind}…`);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/social-upload/?kind=${kind}`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'upload failed');
      await setProfileImage({ url: data.url, kind, address }).unwrap();
      toast.update(t, {
        render: `${kind === 'banner' ? 'Banner' : 'Avatar'} updated (${(data.bytes / 1024).toFixed(0)}KB)`,
        type: 'success',
        isLoading: false,
        autoClose: 3000,
      });
    } catch (err: any) {
      toast.update(t, {
        render: err?.data?.error || err?.message?.slice(0, 80) || 'Upload failed',
        type: 'error',
        isLoading: false,
        autoClose: 5000,
      });
    }
  };

  if ((profileError as any)?.data?.banned) {
    return (
      <SocialShell>
        <div className='social__empty'>🚫 This account has been suspended.</div>
      </SocialShell>
    );
  }

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
      <div
        className='social-profile__banner'
        data-editable={profile.isSelf}
        title={profile.isSelf ? 'Upload a banner' : undefined}
        onClick={() => profile.isSelf && bannerFileRef.current?.click()}
      >
        {profile.bannerImageS3Path && <PfpImage src={profile.bannerImageS3Path} />}
        {profile.isSelf && <span className='social-profile__banner-edit'>Edit banner</span>}
      </div>
      <input
        ref={bannerFileRef}
        type='file'
        accept='image/jpeg,image/png,image/webp'
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setCropping({ kind: 'banner', file: f });
          e.target.value = '';
        }}
      />
      <input
        ref={avatarFileRef}
        type='file'
        accept='image/jpeg,image/png,image/webp'
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setCropping({ kind: 'avatar', file: f });
          e.target.value = '';
        }}
      />
      {cropping && (
        <MediaCropModal
          file={cropping.file}
          kind={cropping.kind}
          onCancel={() => setCropping(null)}
          onApply={(cropped) => {
            const kind = cropping.kind;
            setCropping(null);
            onImageFile(kind, cropped);
          }}
        />
      )}
      <div className='social-profile__head'>
        <div className='social-profile__avatar' data-verified={profile.pfpVerified}>
          <PfpImage src={profile.profilePicture} />
        </div>
        <div className='social-profile__cta'>
          {profile.isSelf ? (
            <>
              <button
                className='social-profile__follow social-profile__follow--on'
                onClick={() => setEditOpen(true)}
              >
                Edit profile
              </button>
              {!profile.verified && (
                <button className='social-profile__follow' onClick={() => setVerifyOpen(true)}>
                  Get verified
                </button>
              )}
              <button
                className='social-profile__follow social-profile__follow--on'
                onClick={() => avatarFileRef.current?.click()}
              >
                Upload avatar
              </button>
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
                onClick={() => {
                  // DMs are a verified perk — prompt the checkmark immediately
                  if (!viewerVerified) {
                    setVerifyOpen(true);
                    return;
                  }
                  router.push(`/social/messages/?to=${profile.address}`);
                }}
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
        <button
          className='social-profile__handle social-profile__addr'
          title='Copy wallet address'
          onClick={() => {
            navigator.clipboard.writeText(profile.address);
            toast.success('Address copied');
          }}
        >
          {shortenAddress(profile.address)} ⧉
        </button>
        {profile.bio && <p className='social-profile__bio'>{profile.bio}</p>}
        {profile.location && (
          <p className='social-profile__meta'>
            <span>📍 {profile.location}</span>
          </p>
        )}
        {profile.webpage && (
          <a
            className='social-profile__web'
            href={/^https?:\/\//.test(profile.webpage) ? profile.webpage : `https://${profile.webpage}`}
            target='_blank'
            rel='noreferrer noopener'
          >
            🔗 {profile.webpage.replace(/^https?:\/\//, '')}
          </a>
        )}
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
        <TokenPanel address={profile.address} isSelf={profile.isSelf} followers={[]} />
        <EditionPanel address={profile.address} isSelf={profile.isSelf} />
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
      {editOpen && (
        <EditProfileModal
          address={address}
          initial={{
            username: profile.username,
            bio: profile.bio,
            webpage: profile.webpage,
            location: profile.location,
            profilePicture: profile.profilePicture,
            bannerImageS3Path: profile.bannerImageS3Path,
          }}
          onClose={() => setEditOpen(false)}
          onSaved={() => refetchProfile()}
        />
      )}

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
        <MintsGrid address={profile.address} isSelf={profile.isSelf} />
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
