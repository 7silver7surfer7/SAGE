import { useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { useSigner } from 'wagmi';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { tipSage, burnSage } from '@/utilities/tip';
import {
  SocialPost,
  useToggleLikeMutation,
  useToggleRepostMutation,
  useRecordTipMutation,
  useBoostPostMutation,
  useSetCollectibleMutation,
  useCollectPostMutation,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg width='18' height='18' viewBox='0 0 24 24' fill={filled ? 'currentColor' : 'none'} stroke='currentColor' strokeWidth='2'>
    <path d='M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z' />
  </svg>
);
const RepostIcon = () => (
  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
    <path d='M17 1l4 4-4 4' /><path d='M3 11V9a4 4 0 0 1 4-4h14' /><path d='M7 23l-4-4 4-4' /><path d='M21 13v2a4 4 0 0 1-4 4H3' />
  </svg>
);
const ReplyIcon = () => (
  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
    <path d='M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' />
  </svg>
);
const TipIcon = () => (
  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
    <circle cx='12' cy='12' r='9' /><path d='M12 7v10M9.5 9.5h3.2a1.8 1.8 0 0 1 0 3.6H9.5h3.5a1.8 1.8 0 0 1 0 3.6H9' />
  </svg>
);
const FlameIcon = () => (
  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
    <path d='M12 22c4.4 0 7-2.8 7-6.5 0-2.6-1.3-4.4-2.6-6C15.2 8 14 6.6 14 4c-3 1.5-4.3 4-4.6 6.2-.7-.6-1.2-1.5-1.4-2.7C6.4 9 5 11.3 5 13.9 5 19.2 7.6 22 12 22z' />
  </svg>
);
const HexIcon = ({ filled }: { filled?: boolean }) => (
  <svg width='18' height='18' viewBox='0 0 24 24' fill={filled ? 'currentColor' : 'none'} stroke='currentColor' strokeWidth='2'>
    <path d='M12 2l8.5 5v10L12 22l-8.5-5V7L12 2z' />
  </svg>
);
const VerifiedBadge = () => (
  <svg className='social-post__verified-badge' width='14' height='14' viewBox='0 0 24 24' fill='#d4fc52'>
    <path d='M12 1l2.7 2 3.3-.4 1.2 3.1 3 1.5-.7 3.3L23 13l-2.3 2.4.4 3.3-3.1 1.2-1.5 3-3.3-.7L11 23l-2.4-2.3-3.3.4-1.2-3.1-3-1.5.7-3.3L1 11l2.3-2.4L2.9 5.3 6 4.1l1.5-3 3.3.7L12 1z' />
    <path d='M8 12.5l2.6 2.6L16.4 9' stroke='#131917' strokeWidth='2.4' fill='none' />
  </svg>
);

interface Props {
  post: SocialPost;
  onReply?: (post: SocialPost) => void;
  clickable?: boolean;
}

export default function PostCard({ post, onReply, clickable = true }: Props) {
  const router = useRouter();
  const { data: signer } = useSigner();
  const { isSignedIn, walletAddress } = useSAGEAccount();
  const [toggleLike] = useToggleLikeMutation();
  const [toggleRepost] = useToggleRepostMutation();
  const [recordTip] = useRecordTipMutation();
  const [boostPost] = useBoostPostMutation();
  const [setCollectible] = useSetCollectibleMutation();
  const [collectPost] = useCollectPostMutation();
  const [busy, setBusy] = useState(false);

  const displayName = post.author.username
    ? transformTitle(post.author.username)
    : shortenAddress(post.author.address);
  const isOwnPost =
    !!walletAddress && walletAddress.toLowerCase() === post.author.address.toLowerCase();

  const requireAuth = () => {
    if (!isSignedIn) {
      toast.info('Connect your wallet to interact');
      return false;
    }
    return true;
  };
  const requireSigner = () => {
    if (!requireAuth()) return false;
    if (!signer) {
      toast.info('Sign in with your wallet first');
      return false;
    }
    return true;
  };

  const goToProfile = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/social/${post.author.address}`);
  };
  const goToPost = () => {
    if (clickable) router.push(`/social/post/${post.id}`);
  };

  const onLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!requireAuth()) return;
    await toggleLike(post.id);
  };
  const onRepost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!requireAuth()) return;
    await toggleRepost(post.id);
  };

  const onTip = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!requireSigner()) return;
    const raw = window.prompt(`Tip @${displayName} in SAGE — how much?`, '10');
    if (!raw) return;
    const amount = Number(raw);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setBusy(true);
    const t = toast.loading(`Sending ${amount} SAGE…`);
    try {
      const txHash = await tipSage(post.author.address, amount, signer as any);
      await recordTip({ postId: post.id, txHash }).unwrap();
      toast.update(t, { render: `Tipped ${amount} SAGE 🎉`, type: 'success', isLoading: false, autoClose: 4000 });
    } catch (err: any) {
      toast.update(t, {
        render: err?.data?.error || err?.message?.slice(0, 80) || 'Tip failed',
        type: 'error',
        isLoading: false,
        autoClose: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  const onBoost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!requireSigner()) return;
    const raw = window.prompt(
      'Boost this post: burn SAGE to pin it to the top of the global feed.\n10 SAGE = 24 hours (max 7 days). Burned SAGE is gone forever.',
      '10'
    );
    if (!raw) return;
    const amount = Number(raw);
    if (!amount || amount < 1) {
      toast.error('Minimum burn is 1 SAGE');
      return;
    }
    setBusy(true);
    const t = toast.loading(`Burning ${amount} SAGE…`);
    try {
      const txHash = await burnSage(amount, signer as any);
      const r = await boostPost({ postId: post.id, txHash }).unwrap();
      const until = new Date(r.boostedUntil).toLocaleString();
      toast.update(t, { render: `Boosted until ${until} 🔥`, type: 'success', isLoading: false, autoClose: 5000 });
    } catch (err: any) {
      toast.update(t, {
        render: err?.data?.error || err?.message?.slice(0, 80) || 'Boost failed',
        type: 'error',
        isLoading: false,
        autoClose: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  const onSetCollectible = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const raw = window.prompt(
      post.collectPrice === null
        ? 'Sell this post as an NFT: set a collect price in SAGE (0 = free). Collectors pay you directly and get the post minted to their wallet.'
        : `Collect price is ${post.collectPrice} SAGE. Enter a new price, or leave empty to stop new collects.`,
      post.collectPrice === null ? '10' : String(post.collectPrice)
    );
    if (raw === null) return;
    const price = raw.trim() === '' ? null : Number(raw);
    if (price !== null && (isNaN(price) || price < 0)) {
      toast.error('Enter a valid price');
      return;
    }
    try {
      await setCollectible({ postId: post.id, price }).unwrap();
      toast.success(price === null ? 'Collecting closed' : `Collectible at ${price} SAGE`);
    } catch (err: any) {
      toast.error(err?.data?.error || 'Could not update');
    }
  };

  const onCollect = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!requireSigner()) return;
    if (post.collectedByViewer) return;
    const price = post.collectPrice || 0;
    const confirmed = window.confirm(
      price > 0
        ? `Collect this post for ${price} SAGE? You pay @${displayName} directly and the post is minted to your wallet as an NFT.`
        : 'Collect this post for free? It will be minted to your wallet as an NFT.'
    );
    if (!confirmed) return;
    setBusy(true);
    const t = toast.loading(price > 0 ? `Paying ${price} SAGE…` : 'Minting…');
    try {
      let txHash: string | undefined;
      if (price > 0) txHash = await tipSage(post.author.address, price, signer as any);
      toast.update(t, { render: 'Minting your NFT…', isLoading: true });
      const r = await collectPost({ postId: post.id, txHash }).unwrap();
      toast.update(t, {
        render: `Collected! SAGE Social #${post.id} is yours (token ${r.tokenId}) ⬡`,
        type: 'success',
        isLoading: false,
        autoClose: 6000,
      });
    } catch (err: any) {
      toast.update(t, {
        render: err?.data?.error || err?.message?.slice(0, 80) || 'Collect failed',
        type: 'error',
        isLoading: false,
        autoClose: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className='social-post' onClick={goToPost} data-boosted={post.isBoosted}>
      <div
        className='social-post__avatar'
        onClick={goToProfile}
        data-verified={post.author.pfpVerified}
      >
        <PfpImage src={post.author.profilePicture} />
      </div>
      <div className='social-post__body'>
        <div className='social-post__header'>
          <span className='social-post__name' onClick={goToProfile}>
            {displayName}
          </span>
          {post.author.pfpVerified && <VerifiedBadge />}
          <span className='social-post__handle'>{shortenAddress(post.author.address)}</span>
          <span className='social-post__dot'>·</span>
          <span className='social-post__time'>{timeAgo(post.createdAt)}</span>
          {post.isBoosted && (
            <span className='social-post__boosted-chip' title={`${post.boostBurned} SAGE burned`}>
              <FlameIcon /> Boosted
            </span>
          )}
        </div>
        {post.text && <p className='social-post__text'>{post.text}</p>}
        {post.imageUrl && (
          <div className='social-post__media'>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.imageUrl} alt='' />
          </div>
        )}
        {post.collectPrice !== null && !isOwnPost && (
          <button
            className='social-post__collect'
            onClick={onCollect}
            disabled={busy || post.collectedByViewer}
          >
            <HexIcon filled={post.collectedByViewer} />
            {post.collectedByViewer
              ? 'Collected'
              : post.collectPrice > 0
              ? `Collect · ${post.collectPrice} SAGE`
              : 'Collect · free'}
            {post.collectCount > 0 && (
              <span className='social-post__collect-count'>{post.collectCount} minted</span>
            )}
          </button>
        )}
        <div className='social-post__actions'>
          <button
            className='social-post__action'
            onClick={(e) => {
              e.stopPropagation();
              if (onReply) onReply(post);
              else router.push(`/social/post/${post.id}`);
            }}
          >
            <ReplyIcon />
            {post.replyCount > 0 && <span>{post.replyCount}</span>}
          </button>
          <button
            className={`social-post__action ${post.repostedByViewer ? 'social-post__action--reposted' : ''}`}
            onClick={onRepost}
          >
            <RepostIcon />
            {post.repostCount > 0 && <span>{post.repostCount}</span>}
          </button>
          <button
            className={`social-post__action ${post.likedByViewer ? 'social-post__action--liked' : ''}`}
            onClick={onLike}
          >
            <HeartIcon filled={post.likedByViewer} />
            {post.likeCount > 0 && <span>{post.likeCount}</span>}
          </button>
          <button
            className='social-post__action social-post__action--boost'
            onClick={onBoost}
            disabled={busy}
            title='Burn SAGE to boost'
          >
            <FlameIcon />
            {post.boostBurned > 0 && <span>{post.boostBurned}</span>}
          </button>
          {isOwnPost ? (
            <button
              className='social-post__action social-post__action--tip'
              onClick={onSetCollectible}
              title='Sell this post as an NFT'
            >
              <HexIcon />
              <span>
                {post.collectPrice === null
                  ? 'Sell as NFT'
                  : `${post.collectPrice} SAGE · ${post.collectCount} minted`}
              </span>
            </button>
          ) : (
            <button
              className='social-post__action social-post__action--tip'
              onClick={onTip}
              disabled={busy}
            >
              <TipIcon />
              <span>{post.tipTotal > 0 ? `${post.tipTotal} SAGE` : 'Tip'}</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
