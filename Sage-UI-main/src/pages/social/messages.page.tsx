import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import LoaderDots from '@/components/LoaderDots';
import SocialNav from '@/components/Social/SocialNav';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import VerificationModal from '@/components/Social/VerificationModal';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import {
  useGetConversationsQuery,
  useGetMessagesQuery,
  useSendMessageMutation,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

function Thread({ partner }: { partner: string }) {
  const { data, isFetching } = useGetMessagesQuery(partner, {
    pollingInterval: 15_000,
  });
  const [sendMessage, { isLoading: sending }] = useSendMessageMutation();
  const [text, setText] = useState('');
  const [showVerify, setShowVerify] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await sendMessage({ to: partner, text: trimmed }).unwrap();
      setText('');
    } catch (e: any) {
      if (e?.data?.needsVerification) setShowVerify(true);
      else toast.error(e?.data?.error || 'Could not send');
    }
  };

  return (
    <div className='social-dm__thread'>
      <div className='social-dm__scroll'>
        {isFetching && !data ? (
          <LoaderDots />
        ) : (
          (data?.messages || []).map((m) => (
            <div key={m.id} className='social-dm__bubble' data-mine={m.mine}>
              {m.text}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
      <div className='social-dm__composer'>
        <input
          className='social-dm__input'
          placeholder='Message… (sending is a verified feature)'
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <button className='social-dm__send' disabled={!text.trim() || sending} onClick={send}>
          Send
        </button>
      </div>
      {showVerify && <VerificationModal onClose={() => setShowVerify(false)} />}
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
  // ?to=0x… opens (or starts) a thread directly from a profile
  const active = (router.query.to as string) || '';

  return (
    <div className='social'>
      <header className='social__header'>
        <h1 className='social__title'>MESSAGES</h1>
        <p className='social__subtitle'>wallet-to-wallet · sending needs the checkmark</p>
      </header>
      <SocialNav />
      {!isSignedIn ? (
        <div className='social__empty'>Connect your wallet to see your messages.</div>
      ) : (
        <div className='social-dm'>
          <div className='social-dm__list'>
            {isFetching && !data ? (
              <LoaderDots />
            ) : data?.conversations.length ? (
              data.conversations.map((c) => (
                <button
                  key={c.partner.address}
                  className='social-dm__row'
                  data-active={active === c.partner.address}
                  onClick={() => router.push(`/social/messages/?to=${c.partner.address}`)}
                >
                  <div className='social-dm__row-avatar'>
                    <PfpImage src={c.partner.profilePicture} />
                  </div>
                  <div className='social-dm__row-main'>
                    <span className='social-dm__row-name'>
                      {c.partner.username
                        ? transformTitle(c.partner.username)
                        : shortenAddress(c.partner.address)}
                      {c.partner.verified && <VerifiedBadge size={12} />}
                    </span>
                    <span className='social-dm__row-snippet'>{c.lastMessage}</span>
                  </div>
                  {c.unread > 0 && <span className='social-nav__badge'>{c.unread}</span>}
                </button>
              ))
            ) : (
              <div className='social__empty'>
                No conversations yet — open a profile and hit Message.
              </div>
            )}
          </div>
          {active && <Thread partner={active} />}
        </div>
      )}
    </div>
  );
}
