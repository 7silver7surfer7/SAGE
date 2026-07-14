import { useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { useSigner } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { tipSage, sendEth } from '@/utilities/tip';
import { redeemCollectVoucher } from '@/utilities/socialToken';
import { parameters } from '@/constants/config';
import {
  SocialPost,
  useDeletePostMutation,
  useToggleLikeMutation,
  useToggleRepostMutation,
  useRecordTipMutation,
  useSetCollectibleMutation,
  useCollectPostMutation,
  useRequestCollectVoucherMutation,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import VerifiedBadge from './VerifiedBadge';
import VerificationModal from './VerificationModal';
import BoostModal from './BoostModal';

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

/** URLs in post text become real (tappable) links, Twitter-style. */
const URL_SPLIT_RE = /(https?:\/\/[^\s<>"')]+)/g;
function linkifyText(text: string) {
  return text.split(URL_SPLIT_RE).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        className='social-post__link'
        href={part}
        target='_blank'
        rel='noreferrer noopener'
        onClick={(e) => e.stopPropagation()}
      >
        {part.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}
        {part.replace(/^https?:\/\/(www\.)?/, '').length > 40 ? '…' : ''}
      </a>
    ) : (
      part
    )
  );
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
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
  const { isSignedIn, walletAddress, userData } = useSAGEAccount();
  const [toggleLike] = useToggleLikeMutation();
  const [toggleRepost] = useToggleRepostMutation();
  const [recordTip] = useRecordTipMutation();
  const [setCollectible] = useSetCollectibleMutation();
  const [collectPost] = useCollectPostMutation();
  const [requestVoucher] = useRequestCollectVoucherMutation();
  const [deletePost] = useDeletePostMutation();
  const [busy, setBusy] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [showBoost, setShowBoost] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { openConnectModal } = useConnectModal();

  // client-side hide (mute): persists in localStorage so a hidden post stays
  // hidden across reloads, no server round-trip. Self-contained — the card
  // just stops rendering itself.
  const HIDE_KEY = 'sage-social-hidden';
  const readHidden = (): number[] => {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem(HIDE_KEY) || '[]');
    } catch {
      return [];
    }
  };
  const [hidden, setHidden] = useState(() => readHidden().includes(post.id));

  const postUrl = () =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/social/post/${post.id}`;

  const onShareCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    navigator.clipboard.writeText(postUrl());
    toast.success('Link copied');
  };
  const onShareX = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    const text = encodeURIComponent(`${post.text?.slice(0, 180) || 'on SAGE Social'}\n\n${postUrl()}`);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
  };
  const onHide = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    const next = Array.from(new Set([...readHidden(), post.id]));
    try {
      localStorage.setItem(HIDE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota / private-mode failures
    }
    setHidden(true);
    toast.info('Post hidden', { autoClose: 2000 });
  };

  const displayName = post.author.username
    ? transformTitle(post.author.username)
    : shortenAddress(post.author.address);
  // Ownership is session-based, not just the live wallet connection: the
  // signed-in user's address (userData.walletAddress) still resolves even when
  // the wagmi connection is momentarily undefined on load — so "Sell as NFT"
  // reliably shows on your own posts.
  const authorLc = post.author.address.toLowerCase();
  const myAddress = (walletAddress || (userData as any)?.walletAddress || '').toLowerCase();
  const isOwnPost = !!myAddress && myAddress === authorLc;
  const viewerVerified = !!(userData as any)?.verifiedAt || (userData as any)?.role === 'ADMIN';

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

  const onBoost = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!requireSigner()) return;
    setShowBoost(true);
  };

  const onSetCollectible = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // selling is a premium feature — an unverified author gets the $10 verify
    // prompt straight away (the conversion moment), not after entering a price
    if (!viewerVerified) {
      setShowVerify(true);
      return;
    }
    // image posts sell for ETH (the artist sells the artwork); text posts
    // sell for pixels (the points economy)
    const isImageSale = !!post.imageUrl && post.mediaType !== 'video';
    const unit = isImageSale ? 'ETH' : 'pixels';
    const raw = window.prompt(
      post.collectPrice === null
        ? isImageSale
          ? 'Sell this artwork as an NFT — set a price in ETH (e.g. "0.05"). The buyer pays you directly. 0 = free. Leave empty to cancel.'
          : 'Sell this post as an NFT — set a price in pixels (e.g. "500"). Collectors spend pixels, you earn them. 0 = free. Leave empty to cancel.'
        : `Collect price is ${post.collectPrice} ${unit}. Enter a new ${unit} price, or leave empty to stop new collects.`,
      post.collectPrice === null ? (isImageSale ? '0.05' : '500') : String(post.collectPrice)
    );
    if (raw === null) return;
    const price = raw.trim() === '' ? null : Number(raw.trim());
    if (price !== null && (isNaN(price) || price < 0)) {
      toast.error('Enter a valid price');
      return;
    }
    try {
      await setCollectible({ postId: post.id, price }).unwrap();
      toast.success(price === null ? 'Collecting closed' : `Collectible at ${price} ${unit}`);
    } catch (err: any) {
      handleGateError(err, 'Could not update');
    }
  };

  const onCollect = async (e: React.MouseEvent, _payWith?: string) => {
    e.stopPropagation();
    if (!requireAuth()) return;
    if (post.collectedByViewer) return;
    // collecting is a verified perk — prompt the $10 checkmark IMMEDIATELY,
    // before any price dialog (this is the conversion moment)
    if (!viewerVerified) {
      setShowVerify(true);
      return;
    }
    const price = post.collectPrice || 0;
    const isEthSale = post.collectCurrency === 'ETH';
    const payWith = 'POINTS' as const;
    const confirmed = window.confirm(
      price > 0
        ? isEthSale
          ? `Buy this artwork for ${price} ETH? It pays @${displayName} directly and mints to your wallet as an NFT.`
          : `Collect this post for ${Math.ceil(price)} pixels? It mints to your wallet as an NFT and @${displayName} earns the pixels.`
        : 'Collect this post for free? It will be minted to your wallet as an NFT.'
    );
    if (!confirmed) return;
    setBusy(true);
    const t = toast.loading(
      isEthSale && price > 0 ? 'Sending ETH…' : price > 0 ? 'Spending pixels…' : 'Minting…'
    );
    try {
      // ETH sales: pay the author from the buyer's wallet, then the server
      // verifies the tx and mints. Pixels sales: the server moves pixels
      // on-chain and mints — no wallet tx from the collector.
      let txHash: string | undefined;
      if (isEthSale && price > 0) {
        if (!signer) {
          toast.update(t, { render: 'Connect your wallet first', type: 'error', isLoading: false, autoClose: 4000 });
          setBusy(false);
          return;
        }
        txHash = await sendEth(post.author.address, price, signer as any);
        toast.update(t, { render: 'Payment sent — minting…', isLoading: true });
      }
      const r = await collectPost({ postId: post.id, payWith, txHash }).unwrap();
      toast.update(t, {
        render: `Collected! SAGE Social #${post.id} is yours (token ${r.tokenId}) ⬡`,
        type: 'success',
        isLoading: false,
        autoClose: 6000,
      });
    } catch (err: any) {
      toast.update(t, { render: 'Collect failed', type: 'error', isLoading: false, autoClose: 1 });
      handleGateError(err, 'Collect failed');
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;

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
          <div className='social-post__menu-wrap'>
            <button
              className='social-post__menu-btn'
              title='More'
              aria-label='More'
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <div
                  className='social-post__menu-backdrop'
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                  }}
                />
                <div className='social-post__menu' onClick={(e) => e.stopPropagation()}>
                  <button onClick={onShareCopy}>Copy link</button>
                  <button onClick={onShareX}>Share on 𝕏</button>
                  <button onClick={onHide}>Hide this post</button>
                  {isOwnPost && (
                    <button
                      className='social-post__menu-danger'
                      onClick={(e) => {
                        setMenuOpen(false);
                        onDelete(e);
                      }}
                    >
                      Delete post
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        {post.text && <p className='social-post__text'>{linkifyText(post.text)}</p>}
        {post.linkUrl && !post.imageUrl && (
          <a
            className='social-post__linkcard'
            href={post.linkUrl}
            target='_blank'
            rel='noreferrer noopener'
            onClick={(e) => e.stopPropagation()}
          >
            {post.linkImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className='social-post__linkcard-img' src={post.linkImage} alt='' />
            )}
            <span className='social-post__linkcard-body'>
              <span className='social-post__linkcard-domain'>{domainOf(post.linkUrl)}</span>
              {post.linkTitle && (
                <span className='social-post__linkcard-title'>{post.linkTitle}</span>
              )}
              {post.linkDesc && <span className='social-post__linkcard-desc'>{post.linkDesc}</span>}
            </span>
          </a>
        )}
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
            <button
              className='social-post__collect'
              onClick={(e) => onCollect(e, 'POINTS')}
              disabled={busy || post.collectedByViewer}
              title={
                post.collectCurrency === 'ETH'
                  ? 'Pays the artist directly in ETH; the artwork mints to your wallet'
                  : 'Hold SAGE, spend the pixels it earns — the seller receives them'
              }
            >
              <HexIcon filled={post.collectedByViewer} />
              {post.collectedByViewer
                ? 'Collected'
                : post.collectPrice > 0
                ? post.collectCurrency === 'ETH'
                  ? `Buy · ${post.collectPrice} ETH`
                  : `Collect · ${Math.ceil(post.collectPrice)} pixels`
                : 'Collect · free'}
              {post.collectCount > 0 && (
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
            <>
              <button
                className='social-post__action social-post__action--tip'
                onClick={onSetCollectible}
                title={post.collectPrice === null ? 'Sell this post as an NFT' : 'Change the price'}
              >
                <HexIcon />
                <span>
                  {post.collectPrice === null
                    ? 'Sell as NFT'
                    : `${post.collectPrice} ${post.collectCurrency === 'ETH' ? 'ETH' : 'pixels'} · ${post.collectCount} minted`}
                </span>
              </button>
              {post.collectPrice !== null && (
                <button
                  className='social-post__action social-post__stop-sell'
                  title='Stop new collects — already-minted NFTs are unaffected'
                  disabled={busy}
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await setCollectible({ postId: post.id, price: null }).unwrap();
                      toast.success('Selling stopped');
                    } catch (err: any) {
                      handleGateError(err, 'Could not stop selling');
                    }
                  }}
                >
                  Stop selling
                </button>
              )}
            </>
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
      {showBoost && <BoostModal postId={post.id} onClose={() => setShowBoost(false)} />}
    </article>
  );
}
