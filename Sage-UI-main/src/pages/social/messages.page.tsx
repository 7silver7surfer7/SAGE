import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import LoaderDots from '@/components/LoaderDots';
import SocialShell from '@/components/Social/SocialShell';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import VerificationModal from '@/components/Social/VerificationModal';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import ComposeMessageModal from '@/components/Social/ComposeMessageModal';
import {
  useGetConversationsQuery,
  useGetMessagesQuery,
  useLazyGetOlderMessagesQuery,
  useSendMessageMutation,
  DirectMessage,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

const nameOf = (u: { username?: string | null; address: string }) =>
  u.username ? transformTitle(u.username) : shortenAddress(u.address);

/** 1:1 DM thread (sending is verified-only) with scroll-up infinite history. */
function DMThread({ partner }: { partner: string }) {
  const { data, isFetching } = useGetMessagesQuery(partner, { pollingInterval: 15_000 });
  const [fetchOlder, { isFetching: loadingOlder }] = useLazyGetOlderMessagesQuery();
  const [sendMessage, { isLoading: sending }] = useSendMessageMutation();
  const [text, setText] = useState('');
  const [showVerify, setShowVerify] = useState(false);
  // Older pages we've pulled by scrolling up, kept oldest-first and separate
  // from the live latest-window cache so polling never wipes the history.
  const [older, setOlder] = useState<DirectMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // New partner = fresh history stack.
  useEffect(() => { setOlder([]); setHasMore(true); }, [partner]);

  // Stick to the bottom as new messages arrive (but not while paging up).
  useEffect(() => {
    if (!loadingOlder) endRef.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = data?.messages || [];
  // De-dupe in case an older page overlaps the live window.
  const seen = new Set(latest.map((m) => m.id));
  const merged = [...older.filter((m) => !seen.has(m.id)), ...latest];
  const oldestId = merged.length ? merged[0].id : 0;
  const canPage = hasMore && (data?.hasMore ?? true);

  const loadOlder = async () => {
    if (loadingOlder || !oldestId || !canPage) return;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight || 0;
    try {
      const page = await fetchOlder({ partner, before: oldestId }).unwrap();
      setHasMore(page.hasMore);
      if (page.messages.length) {
        setOlder((prev) => [...page.messages, ...prev]);
        // Preserve the reading position: keep the same message under the thumb.
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight;
        });
      }
    } catch { /* transient — user can scroll again */ }
  };

  const onScroll = () => {
    if ((scrollRef.current?.scrollTop || 0) < 48) loadOlder();
  };

  const send = async () => {
    if (!text.trim()) return;
    try {
      await sendMessage({ to: partner, text: text.trim() }).unwrap();
      setText('');
    } catch (e: any) {
      if (e?.data?.needsVerification) setShowVerify(true);
      else toast.error(e?.data?.error || 'Could not send');
    }
  };
  return (
    <div className='social-dm__thread'>
      <div className='social-dm__scroll' ref={scrollRef} onScroll={onScroll}>
        {isFetching && !data ? (
          <LoaderDots />
        ) : (
          <>
            {loadingOlder && <div className='social-dm__older'>Loading earlier…</div>}
            {!canPage && merged.length > 0 && (
              <div className='social-dm__older'>Beginning of conversation</div>
            )}
            {merged.map((m) => (
              <div key={m.id} className='social-dm__bubble' data-mine={m.mine}>{m.text}</div>
            ))}
          </>
        )}
        <div ref={endRef} />
      </div>
      <div className='social-dm__composer'>
        <textarea className='social-dm__input' placeholder='Message… (verified feature)' value={text}
          maxLength={1000} rows={1} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }} />
        <button className='social-dm__send' disabled={!text.trim() || sending} onClick={send}>Send</button>
      </div>
      {showVerify && <VerificationModal onClose={() => setShowVerify(false)} />}
    </div>
  );
}

export default function MessagesPage() {
  const router = useRouter();
  const { isSignedIn } = useSAGEAccount();
  const [composeOpen, setComposeOpen] = useState(false);
  const { data, isFetching } = useGetConversationsQuery(undefined, {
    skip: !isSignedIn,
    pollingInterval: 30_000,
  });
  // ?to=addr opens a direct message thread
  const activeDM = (router.query.to as string) || '';

  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header social__header--row'>
          <div>
            <h1 className='social__title'>MESSAGES</h1>
            <p className='social__subtitle'>direct messages — private, wallet to wallet</p>
          </div>
          {isSignedIn && (
            <button className='social-dm__new' onClick={() => setComposeOpen(true)}>
              ＋ New message
            </button>
          )}
        </header>
        {!isSignedIn ? (
          <div className='social__empty'>Connect your wallet to see your messages.</div>
        ) : (
          <div className='social-dm'>
            <div className='social-dm__list'>
              {isFetching && !data ? (
                <LoaderDots />
              ) : data?.conversations.length ? (
                data.conversations.map((c) => {
                  const isActive = activeDM.toLowerCase() === c.partner.address.toLowerCase();
                  return (
                    <button
                      key={c.partner.address}
                      className='social-dm__row'
                      data-active={isActive}
                      onClick={() => router.push(`/social/messages/?to=${c.partner.address}`)}
                    >
                      <div className='social-dm__row-avatar'>
                        <PfpImage src={c.partner.profilePicture} />
                      </div>
                      <div className='social-dm__row-main'>
                        <span className='social-dm__row-name'>
                          {nameOf(c.partner)}
                          {c.partner.verified && <VerifiedBadge size={12} />}
                        </span>
                        <span className='social-dm__row-snippet'>{c.lastMessage}</span>
                      </div>
                      {c.unread > 0 && <span className='social-nav__badge'>{c.unread}</span>}
                    </button>
                  );
                })
              ) : (
                <div className='social__empty'>
                  No conversations yet — tap ＋ New message to start one.
                </div>
              )}
            </div>
            {activeDM ? (
              <DMThread partner={activeDM} />
            ) : (
              <div className='social-dm__thread social-dm__thread--empty'>
                <div className='social__empty'>Pick a conversation or start a new one.</div>
              </div>
            )}
          </div>
        )}
      </div>
      {composeOpen && (
        <ComposeMessageModal
          onClose={() => setComposeOpen(false)}
          onSent={(addr) => {
            setComposeOpen(false);
            router.push(`/social/messages/?to=${addr}`);
          }}
        />
      )}
    </SocialShell>
  );
}
