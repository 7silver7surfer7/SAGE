import { useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { useSigner } from 'wagmi';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { tipSage } from '@/utilities/tip';
import {
  SocialPost,
  useToggleLikeMutation,
  useToggleRepostMutation,
  useRecordTipMutation,
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

interface Props {
  post: SocialPost;
  onReply?: (post: SocialPost) => void;
  clickable?: boolean;
}

export default function PostCard({ post, onReply, clickable = true }: Props) {
  const router = useRouter();
  const { data: signer } = useSigner();
  const { isSignedIn } = useSAGEAccount();
  const [toggleLike] = useToggleLikeMutation();
  const [toggleRepost] = useToggleRepostMutation();
  const [recordTip] = useRecordTipMutation();
  const [tipping, setTipping] = useState(false);

  const displayName = post.author.username
    ? transformTitle(post.author.username)
    : shortenAddress(post.author.address);

  const requireAuth = () => {
    if (!isSignedIn) {
      toast.info('Connect your wallet to interact');
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
    if (!requireAuth()) return;
    if (!signer) {
      toast.info('Sign in with your wallet first');
      return;
    }
    const raw = window.prompt(`Tip @${displayName} in SAGE — how much?`, '10');
    if (!raw) return;
    const amount = Number(raw);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setTipping(true);
    const t = toast.loading(`Sending ${amount} SAGE…`);
    try {
      const txHash = await tipSage(post.author.address, amount, signer as any);
      await recordTip({ postId: post.id, toAddress: post.author.address, amount, txHash });
      toast.update(t, { render: `Tipped ${amount} SAGE 🎉`, type: 'success', isLoading: false, autoClose: 4000 });
    } catch (err: any) {
      toast.update(t, {
        render: err?.message?.slice(0, 80) || 'Tip failed',
        type: 'error',
        isLoading: false,
        autoClose: 5000,
      });
    } finally {
      setTipping(false);
    }
  };

  return (
    <article className='social-post' onClick={goToPost}>
      <div className='social-post__avatar' onClick={goToProfile}>
        <PfpImage src={post.author.profilePicture} />
      </div>
      <div className='social-post__body'>
        <div className='social-post__header'>
          <span className='social-post__name' onClick={goToProfile}>
            {displayName}
          </span>
          <span className='social-post__handle'>{shortenAddress(post.author.address)}</span>
          <span className='social-post__dot'>·</span>
          <span className='social-post__time'>{timeAgo(post.createdAt)}</span>
        </div>
        {post.text && <p className='social-post__text'>{post.text}</p>}
        {post.imageUrl && (
          <div className='social-post__media'>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.imageUrl} alt='' />
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
          <button className='social-post__action social-post__action--tip' onClick={onTip} disabled={tipping}>
            <TipIcon />
            <span>{post.tipTotal > 0 ? `${post.tipTotal} SAGE` : 'Tip'}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
