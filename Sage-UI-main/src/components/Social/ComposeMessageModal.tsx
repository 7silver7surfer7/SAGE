import { useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { PfpImage } from '@/components/Media/BaseMedia';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import VerificationModal from '@/components/Social/VerificationModal';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import {
  useSearchSocialQuery,
  useSendMessageMutation,
  SocialUserCard,
} from '@/store/socialReducer';

/**
 * "+ New message" — start a direct message with one or more people. Search by
 * name/handle, pick recipients, write the opening line, and it opens a DM with
 * each. (Replaces the old follower-only alpha group rooms.)
 */
export default function ComposeMessageModal({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: (firstAddress: string) => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<SocialUserCard[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const { data, isFetching } = useSearchSocialQuery(q, { skip: q.trim().length < 2 });
  const [sendMessage] = useSendMessageMutation();

  const pickedSet = useMemo(
    () => new Set(picked.map((p) => p.address.toLowerCase())),
    [picked]
  );
  const results = (data?.users || []).filter((u) => !pickedSet.has(u.address.toLowerCase()));

  const nameOf = (u: SocialUserCard) =>
    u.username ? transformTitle(u.username) : shortenAddress(u.address);

  const add = (u: SocialUserCard) => {
    setPicked((p) => [...p, u]);
    setQ('');
  };
  const remove = (addr: string) =>
    setPicked((p) => p.filter((x) => x.address.toLowerCase() !== addr.toLowerCase()));

  const send = async () => {
    if (!picked.length || !text.trim()) return;
    setBusy(true);
    try {
      // one direct thread per recipient
      for (const u of picked) {
        await sendMessage({ to: u.address, text: text.trim() }).unwrap();
      }
      toast.success(picked.length > 1 ? `Sent to ${picked.length} people` : 'Message sent');
      onSent(picked[0].address);
    } catch (e: any) {
      if (e?.data?.needsVerification) setShowVerify(true);
      else toast.error(e?.data?.error || 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='social-verify__overlay' onClick={onClose}>
      <div className='social-verify social-verify--launch' onClick={(e) => e.stopPropagation()}>
        <div className='social-verify__head'>
          <h3>New message</h3>
          <button className='social-verify__close' onClick={onClose}>
            ✕
          </button>
        </div>

        {picked.length > 0 && (
          <div className='social-compose__chips'>
            {picked.map((u) => (
              <span key={u.address} className='social-compose__chip'>
                {nameOf(u)}
                <button onClick={() => remove(u.address)} aria-label='remove'>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <input
          className='social-search__input'
          placeholder='To: search people by name or handle'
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ marginBottom: 8 }}
        />

        {q.trim().length >= 2 && (
          <div className='social-compose__results'>
            {isFetching && !data ? (
              <p className='social__empty'>Searching…</p>
            ) : results.length ? (
              results.slice(0, 8).map((u) => (
                <button key={u.address} className='social-compose__result' onClick={() => add(u)}>
                  <span className='social-compose__result-avatar'>
                    <PfpImage src={u.profilePicture} />
                  </span>
                  <span className='social-compose__result-name'>
                    {nameOf(u)}
                    {u.verified && <VerifiedBadge size={12} />}
                  </span>
                </button>
              ))
            ) : (
              <p className='social__empty'>No one found.</p>
            )}
          </div>
        )}

        <textarea
          className='social-search__input'
          placeholder='Write a message…'
          value={text}
          maxLength={1000}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          style={{ margin: '10px 0 16px', resize: 'vertical', minHeight: 72 }}
        />
        <button
          className='social-verify__buy'
          disabled={busy || !picked.length || !text.trim()}
          onClick={send}
        >
          {busy ? 'Sending…' : picked.length > 1 ? `Send to ${picked.length}` : 'Send'}
        </button>
      </div>
      {showVerify && <VerificationModal onClose={() => setShowVerify(false)} />}
    </div>
  );
}
