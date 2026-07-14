import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { useSigner } from 'wagmi';
import { utils } from 'ethers';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { tipSage, sendEth } from '@/utilities/tip';
import { humanWalletError } from '@/utilities/walletError';
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
  useEditPostMutation,
  usePinPostMutation,
  useBanUserMutation,
} from '@/store/socialReducer';
import { useGetAuctionStateQuery } from '@/store/auctionsReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import VerifiedBadge from './VerifiedBadge';
import VerificationModal from './VerificationModal';
import BoostModal from './BoostModal';

/** live countdown text for the drop bar — "2d 4h", "3h 12m", "4m 09s" */
function countdownText(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

/**
 * The timer chip on a drop post. Auctions read the on-chain auction state —
 * the contract starts the clock at the FIRST BID, so until then there is no
 * end time and the chip says so. Open editions count down to their fixed end.
 */
function DropCountdown({ post }: { post: SocialPost }) {
  const isAuction = post.dropKind === 'auction';
  const { data: auctionState } = useGetAuctionStateQuery(post.dropAuctionId as number, {
    skip: !isAuction || !post.dropAuctionId,
    pollingInterval: 30_000,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  let endMs: number | null = null;
  if (isAuction) {
    if (auctionState?.endTime) endMs = auctionState.endTime * 1000;
    else if (auctionState) endMs = null; // chain confirmed: no bid yet
    else if (post.dropEndTime) endMs = new Date(post.dropEndTime).getTime();
  } else if (post.dropEndTime) {
    endMs = new Date(post.dropEndTime).getTime();
  }
  if (isAuction && !endMs)
    return <span className='social-post__drop-timer'>⏱ first bid starts the timer</span>;
  if (!endMs) return null; // collections: until sold out — no clock
  if (endMs <= now)
    return <span className='social-post__drop-timer'>{isAuction ? '🔨 ended' : '◎ ended'}</span>;
  return <span className='social-post__drop-timer'>⏱ {countdownText(endMs - now)}</span>;
}

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
  const [pinPost] = usePinPostMutation();
  const [banUser] = useBanUserMutation();
  const [busy, setBusy] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  // verified-only post editing (Twitter Blue style): the menu item always
  // shows on own posts; unverified users get the verification upsell
  const [editPost] = useEditPostMutation();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [localEdit, setLocalEdit] = useState<{ text: string; editedAt: string } | null>(null);
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
  const viewerVerified = !!(userData as any)?.verifiedAt;
  const isAdminViewer = (userData as any)?.role === 'ADMIN';

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

  const startEdit = () => {
    setMenuOpen(false);
    if (!viewerVerified) {
      // the upsell: editing is a verified perk — show the paywall
      setShowVerify(true);
      return;
    }
    setEditText(localEdit?.text ?? post.text);
    setEditing(true);
  };

  const saveEdit = async () => {
    const trimmed = editText.trim();
    if (!trimmed && !post.imageUrl) {
      toast.error('A post needs some text');
      return;
    }
    setBusy(true);
    try {
      const { post: updated } = await editPost({ postId: post.id, text: trimmed }).unwrap();
      setLocalEdit({ text: updated.text, editedAt: updated.editedAt || new Date().toISOString() });
      setEditing(false);
      toast.success('Post updated');
    } catch (err: any) {
      if (err?.data?.needsVerification) setShowVerify(true);
      else toast.error(err?.data?.error || 'Could not edit');
    } finally {
      setBusy(false);
    }
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
        render: err?.data?.error || `Tip failed — ${humanWalletError(err)}`,
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
          ? 'Sell this artwork as an NFT — set a price in ETH (e.g. "0.001"). The buyer pays you directly. 0 = free. Leave empty to cancel.'
          : 'Sell this post as an NFT — set a price in pixels (e.g. "500"). Collectors spend pixels, you earn them. 0 = free. Leave empty to cancel.'
        : `Collect price is ${post.collectPrice} ${unit}. Enter a new ${unit} price, or leave empty to stop new collects.`,
      post.collectPrice === null ? (isImageSale ? '0.001' : '500') : String(post.collectPrice)
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
        // pre-flight: a raw wallet revert reads as 'Internal JSON-RPC error' —
        // check the balance FIRST and say it in plain words
        const bal = await (signer as any).getBalance();
        const need = utils.parseEther(String(price));
        if (bal.lt(need)) {
          toast.update(t, {
            render: `Not minted — not enough ETH (need ${price}, you have ${(+utils.formatEther(bal)).toFixed(5)})`,
            type: 'error',
            isLoading: false,
            autoClose: 8000,
          });
          setBusy(false);
          return;
        }
        try {
          txHash = await sendEth(post.author.address, price, signer as any);
        } catch (payErr: any) {
          toast.update(t, {
            render: `Not minted — ${humanWalletError(payErr, price)}`,
            type: 'error',
            isLoading: false,
            autoClose: 8000,
          });
          setBusy(false);
          return;
        }
        toast.update(t, { render: 'Payment sent — minting…', isLoading: true });
      }
      const r = await collectPost({ postId: post.id, payWith, txHash }).unwrap();
      toast.update(t, {
        render: `Minted ⬡ SAGE Social #${post.id} is in your wallet (token ${r.tokenId}${
          r.pointsSpent ? `, ${r.pointsSpent} pixels` : ''
        })`,
        type: 'success',
        isLoading: false,
        autoClose: 7000,
      });
    } catch (err: any) {
      // surface the SERVER's reason in the toast — 'Collect failed' alone
      // tells the user nothing (wrong balance? own post? not verified?)
      if (err?.data?.needsVerification) {
        toast.dismiss(t);
        setShowVerify(true);
      } else {
        const msg = err?.data?.error || err?.message?.slice(0, 90) || 'unknown error';
        toast.update(t, {
          render: `Not minted — ${msg}`,
          type: 'error',
          isLoading: false,
          autoClose: 8000,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;

  return (
    <article className='social-post' onClick={goToPost} data-boosted={post.isBoosted}>
      {post.isPinned && (
        <div className='social-post__pinned'>📌 Pinned</div>
      )}
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
            <span className='social-post__boosted-chip' title={`${post.boostBurned} ETH spent boosting`}>
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
                  {isAdminViewer && !isOwnPost && (
                    <button
                      className='social-post__menu-danger'
                      onClick={async (e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        const reason = window.prompt(
                          `Ban ${displayName} (${post.author.address})? Their profile, posts and drops go down immediately. Optional reason:`
                        );
                        if (reason === null) return; // cancelled
                        try {
                          await banUser({ address: post.author.address, reason: reason || undefined }).unwrap();
                          toast.success(`${displayName} has been banned`);
                        } catch (err: any) {
                          toast.error(err?.data?.error || 'Could not ban user');
                        }
                      }}
                    >
                      🚫 Ban user
                    </button>
                  )}
                  {isOwnPost && !post.dropId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit();
                      }}
                    >
                      Edit post {!viewerVerified && '✦'}
                    </button>
                  )}
                  {isOwnPost && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        try {
                          await pinPost({ postId: post.isPinned ? undefined : post.id }).unwrap();
                          toast.success(post.isPinned ? 'Unpinned' : 'Pinned to your profile');
                        } catch (err: any) {
                          toast.error(err?.data?.error || 'Could not update pin');
                        }
                      }}
                    >
                      {post.isPinned ? 'Unpin from profile' : 'Pin to your profile'}
                    </button>
                  )}
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
        {editing ? (
          <div className='social-post__edit' onClick={(e) => e.stopPropagation()}>
            <textarea
              className='social-search__input'
              value={editText}
              maxLength={500}
              rows={3}
              autoFocus
              onChange={(e) => setEditText(e.target.value)}
            />
            <div className='social-post__edit-row'>
              <button className='social-refer__btn' disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className='social-verify__buy' disabled={busy} onClick={saveEdit}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          (localEdit?.text ?? post.text) && (
            <p className='social-post__text'>
              {linkifyText(localEdit?.text ?? post.text)}
              {(localEdit?.editedAt || post.editedAt) && (
                <span className='social-post__edited' title='This post was edited'>
                  {' '}· edited
                </span>
              )}
            </p>
          )
        )}
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
        {post.dropId && (
          <button
            className='social-post__drop-cta'
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/drops/${post.dropId}`);
            }}
          >
            <span className='social-post__drop-kind'>
              {post.dropKind === 'auction'
                ? '🔨 LIVE AUCTION'
                : post.dropKind === 'collection'
                ? '🗂 COLLECTION MINT'
                : '◎ OPEN EDITION'}
            </span>
            <span className='social-post__drop-price'>
              {post.dropKind === 'auction'
                ? `reserve ${post.dropPrice} ETH`
                : `${post.dropPrice} ETH / mint`}
            </span>
            <DropCountdown post={post} />
            <span className='social-post__drop-go'>
              {post.dropKind === 'auction' ? 'Place bid →' : 'Mint →'}
            </span>
          </button>
        )}
        {post.collectPrice !== null && !post.dropId && (
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
            title='Boost this post (ETH)'
          >
            <FlameIcon />
            {post.boostBurned > 0 && <span>{post.boostBurned}</span>}
          </button>
          {isOwnPost ? (
            // Drop posts are storefronts — bids/mints happen through the drop
            // itself, so the collect-as-NFT controls make no sense on them.
            post.dropId ? null : (
            <>
              <button
                className='social-post__action social-post__action--tip'
                onClick={post.collectPrice === null ? onSetCollectible : (e) => onCollect(e)}
                title={
                  post.collectPrice === null
                    ? 'Sell this post as an NFT'
                    : 'Mint one for yourself'
                }
              >
                <HexIcon />
                <span>
                  {post.collectPrice === null
                    ? 'Sell as NFT'
                    : `${post.collectPrice} ${post.collectCurrency === 'ETH' ? 'ETH' : 'pixels'} · ${post.collectCount} minted`}
                </span>
              </button>
              {post.collectPrice !== null && (
                <>
                  <button
                    className='social-post__action social-post__stop-sell'
                    title='Change the price'
                    disabled={busy}
                    onClick={onSetCollectible}
                  >
                    Reprice
                  </button>
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
                </>
              )}
            </>
            )
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
