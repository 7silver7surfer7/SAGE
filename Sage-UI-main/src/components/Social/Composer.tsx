import { useState } from 'react';
import { toast } from 'react-toastify';
import { PfpImage } from '@/components/Media/BaseMedia';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import {
  useCreatePostMutation,
  useGetSocialProfileQuery,
  useRedeemInviteMutation,
} from '@/store/socialReducer';

interface Props {
  replyToId?: number;
  placeholder?: string;
  autoFocus?: boolean;
  onPosted?: () => void;
}

const MAX = 500;

/** Invite-gate state of the composer: SAGE Social sign-ups run on referrals. */
function InviteGate() {
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
          SAGE Social is <b>invite-only</b>. Redeem an invite code to start posting — ask a
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

export default function Composer({ replyToId, placeholder, autoFocus, onPosted }: Props) {
  const { isSignedIn, userData, walletAddress } = useSAGEAccount();
  const { data: me } = useGetSocialProfileQuery(walletAddress || '', {
    skip: !isSignedIn || !walletAddress,
  });
  const [createPost, { isLoading }] = useCreatePostMutation();
  const [text, setText] = useState('');

  if (!isSignedIn) {
    return (
      <div className='social-composer social-composer--locked'>
        Connect your wallet to post on SAGE Social.
      </div>
    );
  }
  if (me?.needsInvite) return <InviteGate />;

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await createPost({ text: trimmed, replyToId }).unwrap();
      setText('');
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
        <div className='social-composer__footer'>
          <span
            className='social-composer__count'
            data-low={remaining <= 40 ? 'true' : undefined}
          >
            {remaining}
          </span>
          <button
            className='social-composer__submit'
            disabled={!text.trim() || isLoading}
            onClick={submit}
          >
            {isLoading ? 'Posting…' : replyToId ? 'Reply' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}
