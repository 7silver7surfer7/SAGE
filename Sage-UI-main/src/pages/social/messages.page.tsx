import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import LoaderDots from '@/components/LoaderDots';
import SocialShell from '@/components/Social/SocialShell';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import AgentBadge from '@/components/Social/AgentBadge';
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
  SocialUserCard,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

const nameOf = (u: { username?: string | null; address: string }) =>
  u.username ? transformTitle(u.username) : shortenAddress(u.address);

/** "4h" / "3d" / "5w" — Twitter's compact conversation-list timestamp. */
function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  if (s < 31536000) return `${Math.floor(s / 604800)}w`;
  return new Date(iso).toLocaleDateString();
}
/** "5:14 PM" — one clock time shown per group of consecutive messages. */
function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Consecutive messages from the same side collapse into one visual group,
 *  reading like a real conversation instead of an evenly-spaced list. */
function groupMessages(messages: DirectMessage[]): { mine: boolean; messages: DirectMessage[] }[] {
  const groups: { mine: boolean; messages: DirectMessage[] }[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && last.mine === m.mine) last.messages.push(m);
    else groups.push({ mine: m.mine, messages: [m] });
  }
  return groups;
}

const BackIcon = () => (
  <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
    <path d='M19 12H5M12 19l-7-7 7-7' strokeLinecap='round' strokeLinejoin='round' />
  </svg>
);

/** 1:1 DM thread (sending is verified-only) with scroll-up infinite history. */
function DMThread({ partner, partnerCard }: { partner: string; partnerCard?: SocialUserCard }) {
  const router = useRouter();
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
      <div className='social-dm__thread-header'>
        <button
          className='social-dm__back'
          onClick={() => router.push('/social/messages/')}
          aria-label='Back to conversations'
        >
          <BackIcon />
        </button>
        {partnerCard && (
          <button className='social-dm__thread-who' onClick={() => router.push(`/social/${partner}`)}>
            <div className='social-dm__row-avatar'>
              <PfpImage src={partnerCard.profilePicture} />
            </div>
            <span className='social-dm__row-name'>
              {nameOf(partnerCard)}
              {partnerCard.verified && <VerifiedBadge size={12} />}
              {partnerCard.isAgent && <AgentBadge size={12} />}
            </span>
          </button>
        )}
      </div>
      <div className='social-dm__scroll' ref={scrollRef} onScroll={onScroll}>
        {isFetching && !data ? (
          <LoaderDots />
        ) : (
          <>
            {loadingOlder && <div className='social-dm__older'>Loading earlier…</div>}
            {!canPage && merged.length > 0 && (
              <div className='social-dm__older'>Beginning of conversation</div>
            )}
            {groupMessages(merged).map((g) => (
              <div key={g.messages[0].id} className='social-dm__group' data-mine={g.mine}>
                {g.messages.map((m) => (
                  <div key={m.id} className='social-dm__bubble' data-mine={m.mine}>{m.text}</div>
                ))}
                <span className='social-dm__group-time'>
                  {clockTime(g.messages[g.messages.length - 1].createdAt)}
                </span>
              </div>
            ))}
          </>
        )}
        <div ref={endRef} />
      </div>
      <div className='social-dm__composer'>
        <textarea className='social-dm__input' placeholder='Message' value={text}
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
  const { isSignedIn, userData } = useSAGEAccount();
  const viewerVerified =
    !!(userData as any)?.verifiedAt;
  const [composeOpen, setComposeOpen] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const { data, isFetching } = useGetConversationsQuery(undefined, {
    skip: !isSignedIn,
    pollingInterval: 30_000,
  });
  // ?to=addr opens a direct message thread
  const activeDM = (router.query.to as string) || '';

  return (
    <SocialShell>
      <div className='social' data-has-active={!!activeDM}>
        <header className='social__header social__header--row'>
          <div>
            <h1 className='social__title'>MESSAGES</h1>
            <p className='social__subtitle'>direct messages — private, wallet to wallet</p>
          </div>
          {isSignedIn && (
            <button
              className='social-dm__new'
              onClick={() => {
                // messaging is a verified perk — prompt the checkmark first
                if (!viewerVerified) setShowVerify(true);
                else setComposeOpen(true);
              }}
            >
              ＋ New message
            </button>
          )}
        </header>
        {!isSignedIn ? (
          <div className='social__empty'>Connect your wallet to see your messages.</div>
        ) : (
          <div className='social-dm' data-has-active={!!activeDM}>
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
                        <span className='social-dm__row-top'>
                          <span className='social-dm__row-name'>
                            {nameOf(c.partner)}
                            {c.partner.verified && <VerifiedBadge size={12} />}
                            {c.partner.isAgent && <AgentBadge size={12} />}
                          </span>
                          <span className='social-dm__row-time'>{timeAgo(c.lastAt)}</span>
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
              <DMThread
                partner={activeDM}
                partnerCard={data?.conversations.find(
                  (c) => c.partner.address.toLowerCase() === activeDM.toLowerCase()
                )?.partner}
              />
            ) : (
              <div className='social-dm__thread social-dm__thread--empty'>
                <div className='social__empty'>Pick a conversation or start a new one.</div>
              </div>
            )}
          </div>
        )}
      </div>
      {showVerify && <VerificationModal onClose={() => setShowVerify(false)} />}
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
