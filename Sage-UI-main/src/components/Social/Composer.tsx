import { useState } from 'react';
import { toast } from 'react-toastify';
import { PfpImage } from '@/components/Media/BaseMedia';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import { useCreatePostMutation } from '@/store/socialReducer';

interface Props {
  replyToId?: number;
  placeholder?: string;
  autoFocus?: boolean;
  onPosted?: () => void;
}

const MAX = 500;

export default function Composer({ replyToId, placeholder, autoFocus, onPosted }: Props) {
  const { isSignedIn, userData } = useSAGEAccount();
  const [createPost, { isLoading }] = useCreatePostMutation();
  const [text, setText] = useState('');

  if (!isSignedIn) {
    return (
      <div className='social-composer social-composer--locked'>
        Connect your wallet to post on SAGE Social.
      </div>
    );
  }

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
