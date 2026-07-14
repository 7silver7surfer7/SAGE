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
  useGetMyFollowingQuery,
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
  // no query yet → suggest the people you follow (who you'd actually DM)
  const { data: followingData } = useGetMyFollowingQuery();
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
      <div className='social-newdm' onClick={(e) => e.stopPropagation()}>
        <div className='social-newdm__head'>
          <h3>New message</h3>
          <button className='social-verify__close' onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Twitter-style To: row — chips inline with the search input */}
        <div className='social-newdm__to'>
          <span className='social-newdm__to-label'>To:</span>
          {picked.map((u) => (
            <span key={u.address} className='social-newdm__chip'>
              {nameOf(u)}
              <button onClick={() => remove(u.address)} aria-label='remove'>
                ✕
              </button>
            </span>
          ))}
          <input
            className='social-newdm__search'
            placeholder={picked.length ? 'add another…' : 'search people'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            // backspace on the empty input pops the last chip, like Twitter
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !q && picked.length)
                remove(picked[picked.length - 1].address);
            }}
            autoFocus
          />
        </div>

        <div className='social-newdm__results'>
          {q.trim().length >= 2 ? (
            isFetching && !data ? (
              <p className='social-newdm__hint'>Searching…</p>
            ) : results.length ? (
              results.slice(0, 8).map((u) => (
                <button key={u.address} className='social-newdm__result' onClick={() => add(u)}>
                  <span className='social-newdm__result-avatar'>
                    <PfpImage src={u.profilePicture} />
                  </span>
                  <span className='social-newdm__result-name'>
                    {nameOf(u)}
                    {u.verified && <VerifiedBadge size={12} />}
                  </span>
                  <span className='social-newdm__result-addr'>{shortenAddress(u.address)}</span>
                </button>
              ))
            ) : (
              <p className='social-newdm__hint'>No one found.</p>
            )
          ) : followingData?.users?.filter((u) => !pickedSet.has(u.address.toLowerCase())).length ? (
            <>
              <p className='social-newdm__section'>People you follow</p>
              {followingData.users
                .filter((u) => !pickedSet.has(u.address.toLowerCase()))
                .slice(0, 8)
                .map((u) => (
                  <button key={u.address} className='social-newdm__result' onClick={() => add(u)}>
                    <span className='social-newdm__result-avatar'>
                      <PfpImage src={u.profilePicture} />
                    </span>
                    <span className='social-newdm__result-name'>
                      {nameOf(u)}
                      {u.verified && <VerifiedBadge size={12} />}
                    </span>
                    <span className='social-newdm__result-addr'>{shortenAddress(u.address)}</span>
                  </button>
                ))}
            </>
          ) : (
            <p className='social-newdm__hint'>
              {picked.length ? 'Add more people, or write your message below.' : 'Type a name or handle to find people.'}
            </p>
          )}
        </div>

        <div className='social-newdm__composer'>
          <textarea
            placeholder='Write a message…'
            value={text}
            maxLength={1000}
            rows={3}
            onChange={(e) => setText(e.target.value)}
          />
          <div className='social-newdm__foot'>
            <span className='social-newdm__count'>{text.length ? `${text.length}/1000` : ''}</span>
            <button
              className='social-newdm__send'
              disabled={busy || !picked.length || !text.trim()}
              onClick={send}
            >
              {busy ? 'Sending…' : picked.length > 1 ? `Send to ${picked.length}` : 'Send'}
            </button>
          </div>
        </div>
      </div>
      {showVerify && <VerificationModal onClose={() => setShowVerify(false)} />}
    </div>
  );
}
