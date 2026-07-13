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
import {
  useGetConversationsQuery,
  useGetMessagesQuery,
  useLazyGetOlderMessagesQuery,
  useSendMessageMutation,
  useGetGroupChatQuery,
  useSendGroupMessageMutation,
  useToggleGroupChatMutation,
  useKickFromGroupChatMutation,
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

/** Alpha group chat thread — followers-only; the owner can kick + toggle. */
function GroupThread({ owner }: { owner: string }) {
  const router = useRouter();
  const { data, error, isFetching } = useGetGroupChatQuery(owner, { pollingInterval: 10_000 });
  const [sendGroup, { isLoading: sending }] = useSendGroupMessageMutation();
  const [toggle] = useToggleGroupChatMutation();
  const [kick] = useKickFromGroupChatMutation();
  const [text, setText] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [data?.messages.length]);
  const errMessage = (error as any)?.data?.error;
  const send = async () => {
    if (!text.trim()) return;
    try { await sendGroup({ owner, text: text.trim() }).unwrap(); setText(''); }
    catch (e: any) { toast.error(e?.data?.error || 'Could not send'); }
  };
  if (errMessage)
    return (
      <div className='social-dm__thread'>
        <div className='social__empty' style={{ padding: 30 }}>
          {errMessage}
          {/follow/i.test(errMessage) && (
            <div style={{ marginTop: 12 }}>
              <button className='social-profile__follow' onClick={() => router.push(`/social/${owner}`)}>
                Follow to enter
              </button>
            </div>
          )}
        </div>
      </div>
    );
  return (
    <div className='social-dm__thread'>
      <div className='social-groupchat__bar'>
        <span>⚡ Alpha chat{data?.isOwner ? ' · your room' : ''}</span>
        {data?.isOwner && (
          <div className='social-groupchat__bar-actions'>
            <button onClick={() => setShowMembers((v) => !v)}>Members ({data.members.length})</button>
            <button onClick={async () => { await toggle({ enabled: false }).unwrap(); toast.success('Alpha chat off'); }}>
              Turn off
            </button>
          </div>
        )}
      </div>
      {showMembers && data?.isOwner && (
        <div className='social-groupchat__members'>
          {data.members.length ? data.members.map((m) => (
            <div key={m.address} className='social-groupchat__member'>
              <span onClick={() => router.push(`/social/${m.address}`)}>
                {nameOf(m)}{m.verified && <VerifiedBadge size={11} />}
              </span>
              <button onClick={async () => {
                if (!window.confirm(`Kick ${nameOf(m)}? They lose access and their messages are removed.`)) return;
                try { await kick({ address: m.address }).unwrap(); toast.success('Kicked'); }
                catch (e: any) { toast.error(e?.data?.error || 'Could not kick'); }
              }}>Kick</button>
            </div>
          )) : <p className='social__empty'>No one has posted yet.</p>}
        </div>
      )}
      <div className='social-dm__scroll'>
        {isFetching && !data ? <LoaderDots /> : (data?.messages || []).length ? (
          data!.messages.map((m) => (
            <div key={m.id} className='social-groupchat__msg' data-mine={m.mine}>
              <span className='social-groupchat__from' onClick={() => router.push(`/social/${m.from.address}`)}>
                {nameOf(m.from)}{m.from.verified && <VerifiedBadge size={11} />}
              </span>
              <div className='social-dm__bubble' data-mine={m.mine}>{m.text}</div>
            </div>
          ))
        ) : <div className='social__empty'>Quiet room — drop the first alpha.</div>}
        <div ref={endRef} />
      </div>
      <div className='social-dm__composer'>
        <textarea className='social-dm__input' placeholder='Share alpha…' value={text} maxLength={1000}
          rows={1} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }} />
        <button className='social-dm__send' disabled={!text.trim() || sending} onClick={send}>Send</button>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const router = useRouter();
  const { isSignedIn } = useSAGEAccount();
  const { data, isFetching } = useGetConversationsQuery(undefined, {
    skip: !isSignedIn,
    pollingInterval: 30_000,
  });
  // ?to=addr opens a DM, ?group=addr opens an alpha chat
  const activeDM = (router.query.to as string) || '';
  const activeGroup = (router.query.group as string) || '';

  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header'>
          <h1 className='social__title'>MESSAGES</h1>
          <p className='social__subtitle'>DMs · alpha chats — group rooms live here</p>
        </header>
        {!isSignedIn ? (
          <div className='social__empty'>Connect your wallet to see your messages.</div>
        ) : (
          <div className='social-dm'>
            <div className='social-dm__list'>
              {isFetching && !data ? <LoaderDots /> : data?.conversations.length ? (
                data.conversations.map((c) => {
                  const isActive = c.isGroup ? activeGroup === c.owner : activeDM === c.partner.address;
                  return (
                    <button key={(c.isGroup ? 'g-' : 'd-') + (c.isGroup ? c.owner : c.partner.address)}
                      className='social-dm__row' data-active={isActive}
                      onClick={() => router.push(c.isGroup ? `/social/messages/?group=${c.owner}` : `/social/messages/?to=${c.partner.address}`)}>
                      <div className='social-dm__row-avatar' data-group={c.isGroup}>
                        {c.isGroup ? <span className='social-dm__group-glyph'>⚡</span> : <PfpImage src={c.partner.profilePicture} />}
                      </div>
                      <div className='social-dm__row-main'>
                        <span className='social-dm__row-name'>
                          {c.isGroup ? `${nameOf(c.partner)}'s alpha` : nameOf(c.partner)}
                          {!c.isGroup && c.partner.verified && <VerifiedBadge size={12} />}
                        </span>
                        <span className='social-dm__row-snippet'>{c.lastMessage}</span>
                      </div>
                      {!c.isGroup && c.unread > 0 && <span className='social-nav__badge'>{c.unread}</span>}
                    </button>
                  );
                })
              ) : <div className='social__empty'>No conversations yet.</div>}
            </div>
            {activeGroup ? <GroupThread owner={activeGroup} /> : activeDM ? <DMThread partner={activeDM} /> : null}
          </div>
        )}
      </div>
    </SocialShell>
  );
}
