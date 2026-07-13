import { useEffect, useRef, useState } from 'react';
import LoaderDots from '@/components/LoaderDots';
import Composer from '@/components/Social/Composer';
import SocialShell from '@/components/Social/SocialShell';
import PostCard from '@/components/Social/PostCard';
import { useGetFeedQuery } from '@/store/socialReducer';

type Scope = 'global' | 'following';

export default function SocialFeedPage() {
  const [scope, setScope] = useState<Scope>('global');
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const { data, isFetching } = useGetFeedQuery({ scope, cursor });
  const sentinelRef = useRef<HTMLDivElement>(null);

  const switchScope = (next: Scope) => {
    setScope(next);
    setCursor(undefined); // fresh list per tab
  };

  // infinite scroll: when the sentinel nears the viewport, pull the next page
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && data?.nextCursor && !isFetching) {
          setCursor(data.nextCursor);
        }
      },
      { rootMargin: '800px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [data?.nextCursor, isFetching]);

  return (
    <SocialShell>
    <div className='social'>
      <header className='social__header'>
        <h1 className='social__title'>SOCIAL</h1>
        <p className='social__subtitle'>your wallet is your handle · tip in SAGE</p>
      </header>

      <div className='social__tabs'>
        <button
          className={`social__tab ${scope === 'global' ? 'social__tab--active' : ''}`}
          onClick={() => switchScope('global')}
        >
          Global
        </button>
        <button
          className={`social__tab ${scope === 'following' ? 'social__tab--active' : ''}`}
          onClick={() => switchScope('following')}
        >
          Following
        </button>
      </div>

      <Composer onPosted={() => setCursor(undefined)} />

      <div className='social__feed'>
        {isFetching && !data ? (
          <LoaderDots />
        ) : data?.posts.length ? (
          <>
            {data.posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
            <div ref={sentinelRef} className='social__sentinel' />
            {isFetching && cursor && <LoaderDots />}
            {!data.nextCursor && data.posts.length > 20 && (
              <div className='social__empty'>You reached the beginning. gm 🌱</div>
            )}
          </>
        ) : (
          <div className='social__empty'>
            {scope === 'following'
              ? 'Follow some wallets to fill this feed.'
              : 'No posts yet — be the first to say something.'}
          </div>
        )}
      </div>
    </div>
    </SocialShell>
  );
}
