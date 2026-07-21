import { useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import {
  useCreatePostMutation,
  useGetSocialProfileQuery,
  useGetPostThreadQuery,
  useRedeemInviteMutation,
} from '@/store/socialReducer';

interface Props {
  /** pre-filled text (e.g. share-to-feed drafts) — user edits before posting */
  initialText?: string;
  replyToId?: number;
  /** quote-repost: embeds this post as a card and increments its quote count */
  quotedPostId?: number;
  placeholder?: string;
  autoFocus?: boolean;
  onPosted?: () => void;
}

const MAX = 500;
const MAX_IMAGE_MB = 12;
const MAX_VIDEO_MB = 25;

/** Invite-gate state: SAGE Social sign-ups run on referrals. Reused anywhere
 * an action requires participation (posting, profile customization, …). */
export function InviteGate({ action = 'posting' }: { action?: string }) {
  const [code, setCode] = useState('');
  const [redeemInvite, { isLoading }] = useRedeemInviteMutation();
  const redeem = async () => {
    try {
      await redeemInvite({ code: code.trim() }).unwrap();
      toast.success('Welcome to SAGE Social 🎉');
    } catch (e: any) {
      toast.error(e?.data?.error || 'Invalid invite code');
    }
  };
  return (
    <div className='social-composer social-composer--locked'>
      <div className='social-composer__gate'>
        <p>
          SAGE Social is <b>invite-only</b>. Redeem an invite code to start {action} — ask a
          member for theirs.
        </p>
        <div className='social-composer__gate-row'>
          <input
            className='social-composer__gate-input'
            placeholder='SAGE-XXXXXX'
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && code.trim()) redeem();
            }}
          />
          <button
            className='social-composer__submit'
            disabled={!code.trim() || isLoading}
            onClick={redeem}
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Composer({
  replyToId,
  quotedPostId,
  placeholder,
  autoFocus,
  onPosted,
  initialText,
}: Props) {
  const { isSignedIn, userData, walletAddress } = useSAGEAccount();
  const { data: me } = useGetSocialProfileQuery(walletAddress || '', {
    skip: !isSignedIn || !walletAddress,
  });
  const { data: quotedThread } = useGetPostThreadQuery(quotedPostId as number, {
    skip: !quotedPostId,
  });
  const quoted = quotedThread?.post;
  const [createPost, { isLoading }] = useCreatePostMutation();
  const [text, setText] = useState(initialText || '');
  const [media, setMedia] = useState<{ url: string; mediaType: 'image' | 'video' } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isSignedIn) {
    return (
      <div className='social-composer social-composer--locked'>
        Connect your wallet to post on SAGE Social.
      </div>
    );
  }
  if (me?.needsInvite) return <InviteGate />;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const capMb = isVideo ? MAX_VIDEO_MB : MAX_IMAGE_MB;
    if (file.size > capMb * 1024 * 1024) {
      toast.error(`${isVideo ? 'Videos' : 'Images'} are capped at ${capMb}MB`);
      return;
    }
    setUploading(true);
    const t = toast.loading(isVideo ? 'Uploading + compressing video…' : 'Uploading image…');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/social-upload/', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'upload failed');
      setMedia({ url: data.url, mediaType: data.mediaType });
      toast.update(t, {
        render: `Ready (${(data.bytes / 1024).toFixed(0)}KB after compression)`,
        type: 'success',
        isLoading: false,
        autoClose: 2500,
      });
    } catch (err: any) {
      toast.update(t, {
        render: err?.message?.slice(0, 90) || 'Upload failed',
        type: 'error',
        isLoading: false,
        autoClose: 5000,
      });
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed && !media && !quotedPostId) return;
    try {
      await createPost({
        text: trimmed,
        imageUrl: media?.url,
        mediaType: media?.mediaType,
        replyToId,
        quotedPostId,
      }).unwrap();
      setText('');
      setMedia(null);
      onPosted?.();
    } catch (e: any) {
      toast.error(e?.data?.error || 'Could not post');
    }
  };

  const remaining = MAX - text.length;

  return (
    <div className='social-composer'>
      <div className='social-composer__avatar'>
        <PfpImage src={userData?.profilePicture} />
      </div>
      <div className='social-composer__main'>
        <textarea
          className='social-composer__input'
          placeholder={placeholder || "What's happening on-chain?"}
          value={text}
          maxLength={MAX}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
          }}
        />
        {media && (
          <div className='social-composer__preview'>
            {media.mediaType === 'video' ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={media.url} controls playsInline preload='metadata' />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media.url} alt='' />
            )}
            <button
              className='social-composer__preview-remove'
              onClick={() => setMedia(null)}
              title='Remove media'
            >
              ✕
            </button>
          </div>
        )}
        {quoted && (
          <div className='social-composer__quoted'>
            <div className='social-composer__quoted-head'>
              <div className='social-composer__quoted-avatar'>
                <PfpImage src={quoted.author.profilePicture} />
              </div>
              <span>
                {quoted.author.username
                  ? transformTitle(quoted.author.username)
                  : shortenAddress(quoted.author.address)}
              </span>
            </div>
            {quoted.text && <p>{quoted.text}</p>}
          </div>
        )}
        <div className='social-composer__footer'>
          <input
            ref={fileRef}
            type='file'
            accept='image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime'
            style={{ display: 'none' }}
            onChange={onFile}
          />
          <button
            className='social-composer__media-btn'
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            title='Add an image or video'
          >
            <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
              <rect x='3' y='3' width='18' height='18' rx='3' />
              <circle cx='8.5' cy='8.5' r='1.5' />
              <path d='M21 15l-5-5L5 21' />
            </svg>
          </button>
          <span
            className='social-composer__count'
            data-low={remaining <= 40 ? 'true' : undefined}
          >
            {remaining}
          </span>
          <button
            className='social-composer__submit'
            disabled={(!text.trim() && !media && !quotedPostId) || isLoading || uploading}
            onClick={submit}
          >
            {isLoading ? 'Posting…' : replyToId ? 'Reply' : quotedPostId ? 'Quote' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}
