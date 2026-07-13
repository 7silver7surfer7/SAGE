import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import LoaderDots from '@/components/LoaderDots';
import SocialShell from '@/components/Social/SocialShell';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import {
  useGetGroupChatQuery,
  useSendGroupMessageMutation,
  useToggleGroupChatMutation,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

/**
 * The alpha chat: a premium user's followers-only group room. Auto-created
 * at verification; follow the owner to enter; the owner can switch it off.
 */
export default function AlphaChatPage() {
  const router = useRouter();
  const owner = (router.query.owner as string) || '';
  const { isSignedIn } = useSAGEAccount();
  const { data, error, isFetching } = useGetGroupChatQuery(owner, {
    skip: !owner || !isSignedIn,
    pollingInterval: 10_000,
  });
  const [sendMessage, { isLoading: sending }] = useSendGroupMessageMutation();
  const [toggle] = useToggleGroupChatMutation();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await sendMessage({ owner, text: trimmed }).unwrap();
      setText('');
    } catch (e: any) {
      toast.error(e?.data?.error || 'Could not send');
    }
  };

  const errMessage = (error as any)?.data?.error;

  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header'>
          <h1 className='social__title'>ALPHA CHAT</h1>
          <p className='social__subtitle'>
            {shortenAddress(owner)}&apos;s followers-only room
          </p>
        </header>
        {!isSignedIn ? (
          <div className='social__empty'>Connect your wallet to enter.</div>
        ) : errMessage ? (
          <div className='social__empty'>
            {errMessage}
            {/follow/i.test(errMessage) && (
              <div style={{ marginTop: 12 }}>
                <button
                  className='social-profile__follow'
                  onClick={() => router.push(`/social/${owner}`)}
                >
                  Go follow {shortenAddress(owner)}
                </button>
              </div>
            )}
          </div>
        ) : isFetching && !data ? (
          <LoaderDots />
        ) : data ? (
          <div className='social-dm__thread' style={{ maxHeight: '65vh' }}>
            {data.isOwner && (
              <div className='social-groupchat__ownerbar'>
                <span>Your alpha room — followers can read and post.</span>
                <button
                  className='social-refer__btn'
                  onClick={async () => {
                    await toggle({ enabled: false }).unwrap();
                    toast.success('Alpha chat switched off');
                    router.push(`/social/${owner}`);
                  }}
                >
                  Turn off
                </button>
              </div>
            )}
            <div className='social-dm__scroll'>
              {data.messages.length ? (
                data.messages.map((m) => (
                  <div key={m.id} className='social-groupchat__msg' data-mine={m.mine}>
                    <span
                      className='social-groupchat__from'
                      onClick={() => router.push(`/social/${m.from.address}`)}
                    >
                      {m.from.username
                        ? transformTitle(m.from.username)
                        : shortenAddress(m.from.address)}
                      {m.from.verified && <VerifiedBadge size={11} />}
                    </span>
                    <div className='social-dm__bubble' data-mine={m.mine}>
                      {m.text}
                    </div>
                  </div>
                ))
              ) : (
                <div className='social__empty'>Quiet room. Drop the first alpha.</div>
              )}
              <div ref={endRef} />
            </div>
            <div className='social-dm__composer'>
              <input
                className='social-dm__input'
                placeholder='Share alpha with the room…'
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
          </div>
        ) : null}
      </div>
    </SocialShell>
  );
}
