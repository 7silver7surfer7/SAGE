import { useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { useSigner } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { tipSage, burnSage, sendEth } from '@/utilities/tip';
import { redeemCollectVoucher } from '@/utilities/socialToken';
import { parameters } from '@/constants/config';
import {
  SocialPost,
  useDeletePostMutation,
  useToggleLikeMutation,
  useToggleRepostMutation,
  useRecordTipMutation,
  useBoostPostMutation,
  useSetCollectibleMutation,
  useCollectPostMutation,
  useRequestCollectVoucherMutation,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import VerifiedBadge from './VerifiedBadge';
import VerificationModal from './VerificationModal';

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
  const [requestVoucher] = useRequestCollectVoucherMutation();
  const [deletePost] = useDeletePostMutation();
  const [busy, setBusy] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const { openConnectModal } = useConnectModal();

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
      // session cookie survives reloads but the wallet connection doesn't —
      // reopen the connect modal instead of dead-ending the click
      toast.info('Reconnect your wallet to sign transactions');
      openConnectModal?.();
      return false;
    }
    return true;
  };

  // premium-gated API errors carry needsVerification — open the paywall
  const handleGateError = (err: any, fallback: string) => {
    if (err?.data?.needsVerification) {
      setShowVerify(true);
      return;
    }
    toast.error(err?.data?.error || err?.message?.slice(0, 80) || fallback);
  };

  const onDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this post? Tips stay on the record, the post disappears from feeds.'))
      return;
    try {
      await deletePost(post.id).unwrap();
      toast.success('Post deleted');
    } catch (err: any) {
      toast.error(err?.data?.error || 'Could not delete');
    }
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
    const raw = window.prompt(
      `Tip @${displayName} — enter a SAGE amount (e.g. "10"), or add ETH to tip native ETH (e.g. "0.01 ETH")`,
      '10'
    );
    if (!raw) return;
    const isEth = /eth?\s*$/i.test(raw.trim());
    const currency: 'SAGE' | 'ETH' = isEth ? 'ETH' : 'SAGE';
    const amount = Number(raw.trim().replace(/eth?\s*$/i, '').trim());
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setBusy(true);
    const t = toast.loading(`Sending ${amount} ${currency}…`);
    try {
      const txHash =
        currency === 'ETH'
          ? await sendEth(post.author.address, amount, signer as any)
          : await tipSage(post.author.address, amount, signer as any);
      await recordTip({ postId: post.id, txHash, currency }).unwrap();
      toast.update(t, { render: `Tipped ${amount} ${currency} 🎉`, type: 'success', isLoading: false, autoClose: 4000 });
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
      toast.update(t, { render: 'Boost failed', type: 'error', isLoading: false, autoClose: 1 });
      handleGateError(err, 'Boost failed');
    } finally {
      setBusy(false);
    }
  };

  const onSetCollectible = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const raw = window.prompt(
      post.collectPrice === null
        ? 'Sell this post as an NFT: set a price in SAGE (e.g. "10"), or in native ETH with a suffix (e.g. "0.01 ETH"). 0 = free. Leave empty to cancel.'
        : `Collect price is ${post.collectPrice} ${post.collectCurrency}. Enter a new price ("10" = SAGE, "0.01 ETH" = ETH), or leave empty to stop new collects.`,
      post.collectPrice === null ? '10' : String(post.collectPrice)
    );
    if (raw === null) return;
    const isEth = /eth?\s*$/i.test(raw.trim());
    const currency: 'SAGE' | 'ETH' = isEth ? 'ETH' : 'SAGE';
    const price = raw.trim() === '' ? null : Number(raw.trim().replace(/eth?\s*$/i, '').trim());
    if (price !== null && (isNaN(price) || price < 0)) {
      toast.error('Enter a valid price');
      return;
    }
    try {
      await setCollectible({ postId: post.id, price, currency }).unwrap();
      toast.success(price === null ? 'Collecting closed' : `Collectible at ${price} ${currency}`);
    } catch (err: any) {
      handleGateError(err, 'Could not update');
    }
  };

  const onCollect = async (e: React.MouseEvent, payWith: 'SAGE' | 'POINTS' = 'SAGE') => {
    e.stopPropagation();
    if (payWith === 'SAGE' && !requireSigner()) return;
    if (payWith === 'POINTS' && !requireAuth()) return;
    if (post.collectedByViewer) return;
    const price = post.collectPrice || 0;
    const cur = post.collectCurrency;
    const confirmed = window.confirm(
      payWith === 'POINTS'
        ? `Collect this post for ${Math.ceil(price * 100)} pixels? The post is minted to your wallet as an NFT.`
        : price > 0
        ? `Collect this post for ${price} ${cur}? You pay @${displayName} directly and the post is minted to your wallet as an NFT.`
        : 'Collect this post for free? It will be minted to your wallet as an NFT.'
    );
    if (!confirmed) return;
    setBusy(true);
    const t = toast.loading(
      payWith === 'POINTS' ? 'Spending pixels…' : price > 0 ? `Paying ${price} ${cur}…` : 'Minting…'
    );
    try {
      let txHash: string | undefined;
      if (payWith === 'SAGE' && price > 0)
        txHash =
          cur === 'ETH'
            ? await sendEth(post.author.address, price, signer as any)
            : await tipSage(post.author.address, price, signer as any);
      // buyer-pays-gas: if the voucher minter is live, the collector submits
      // the mint themselves (paying its gas) with a server-signed voucher
      if (parameters.SOCIAL_COLLECT_MINTER_ADDRESS && signer) {
        const v = await requestVoucher({ postId: post.id, txHash, payWith }).unwrap();
        toast.update(t, { render: 'Sign to mint your NFT…', isLoading: true });
        const mintTx = await redeemCollectVoucher(v.minter, v.postId, v.uri, v.signature, signer as any);
        toast.update(t, {
          render: `Collected! You minted SAGE Social #${post.id} (${mintTx.slice(0, 10)}…) ⬡`,
          type: 'success',
          isLoading: false,
          autoClose: 6000,
        });
      } else {
        toast.update(t, { render: 'Minting your NFT…', isLoading: true });
        const r = await collectPost({ postId: post.id, txHash, payWith }).unwrap();
        toast.update(t, {
          render: `Collected! SAGE Social #${post.id} is yours (token ${r.tokenId}) ⬡`,
          type: 'success',
          isLoading: false,
          autoClose: 6000,
        });
      }
    } catch (err: any) {
      toast.update(t, { render: 'Collect failed', type: 'error', isLoading: false, autoClose: 1 });
      handleGateError(err, 'Collect failed');
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
          {post.author.verified && <VerifiedBadge />}
          <span className='social-post__handle'>{shortenAddress(post.author.address)}</span>
          <span className='social-post__dot'>·</span>
          <span className='social-post__time'>{timeAgo(post.createdAt)}</span>
          {post.isBoosted && (
            <span className='social-post__boosted-chip' title={`${post.boostBurned} SAGE burned`}>
              <FlameIcon /> Boosted
            </span>
          )}
          {isOwnPost && (
            <button className='social-post__delete' title='Delete post' onClick={onDelete}>
              ✕
            </button>
          )}
        </div>
        {post.text && <p className='social-post__text'>{post.text}</p>}
        {post.imageUrl && (
          <div className='social-post__media' onClick={(e) => e.stopPropagation()}>
            {post.mediaType === 'video' ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={post.imageUrl} controls playsInline preload='metadata' />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.imageUrl} alt='' />
            )}
          </div>
        )}
        {post.collectPrice !== null && !isOwnPost && (
          <div className='social-post__collect-row'>
            {post.collectPrice > 0 && post.collectCurrency === 'SAGE' && !post.collectedByViewer && (
              <button
                className='social-post__collect'
                onClick={(e) => onCollect(e, 'POINTS')}
                disabled={busy}
                title='Hold SAGE, spend the pixels it earns — the seller receives them'
              >
                <HexIcon />
                {`Collect · ${Math.ceil(post.collectPrice * 100)} pixels`}
                {post.collectCount > 0 && (
                  <span className='social-post__collect-count'>{post.collectCount} minted</span>
                )}
              </button>
            )}
            <button
              className={`social-post__collect ${post.collectPrice > 0 && post.collectCurrency === 'SAGE' && !post.collectedByViewer ? 'social-post__collect--points' : ''}`}
              onClick={(e) => onCollect(e, 'SAGE')}
              disabled={busy || post.collectedByViewer}
            >
              {post.collectedByViewer ? <HexIcon filled /> : null}
              {post.collectedByViewer
                ? 'Collected'
                : post.collectPrice > 0
                ? `${post.collectPrice} ${post.collectCurrency}`
                : 'Collect · free'}
              {(post.collectPrice === 0 || post.collectCurrency === 'ETH' || post.collectedByViewer) &&
                post.collectCount > 0 && (
                  <span className='social-post__collect-count'>{post.collectCount} minted</span>
                )}
            </button>
          </div>
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
                  : `${post.collectPrice} ${post.collectCurrency} · ${post.collectCount} minted`}
              </span>
            </button>
          ) : (
            <button
              className='social-post__action social-post__action--tip'
              onClick={onTip}
              disabled={busy}
            >
              <TipIcon />
              <span>
                {post.tipTotal > 0 || post.tipTotalEth > 0
                  ? [
                      post.tipTotal > 0 ? `${post.tipTotal} SAGE` : '',
                      post.tipTotalEth > 0 ? `${post.tipTotalEth} ETH` : '',
                    ]
                      .filter(Boolean)
                      .join(' + ')
                  : 'Tip'}
              </span>
            </button>
          )}
        </div>
      </div>
      {showVerify && <VerificationModal onClose={() => setShowVerify(false)} />}
    </article>
  );
}
