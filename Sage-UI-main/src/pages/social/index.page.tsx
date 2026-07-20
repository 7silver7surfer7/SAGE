import { useEffect, useRef, useState } from 'react';
import LoaderDots from '@/components/LoaderDots';
import Composer from '@/components/Social/Composer';
import SocialShell from '@/components/Social/SocialShell';
import PostCard from '@/components/Social/PostCard';
import { useGetFeedQuery } from '@/store/socialReducer';

type Scope = 'global' | 'latest' | 'following';

export default function SocialFeedPage() {
  const [scope, setScope] = useState<Scope>('global');
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  // A fresh seed per page-load remixes the global ranking — every refresh
  // shows a different cut of the network, not the same top posts.
  const [seed] = useState(() => Math.random().toString(36).slice(2, 10));
  // pause polling in hidden tabs — a parked feed tab was a pure server cost
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const on = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  // live feed: refetch on every visit and poll the top so drip/real posts
  // stream in without a hard reload (the ticker already polls; match it)
  const { data, isFetching } = useGetFeedQuery(
    { scope, cursor, seed: scope === 'global' ? seed : undefined },
    { refetchOnMountOrArgChange: true, pollingInterval: !cursor && tabVisible ? 15000 : 0 }
  );
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
          className={`social__tab ${scope === 'latest' ? 'social__tab--active' : ''}`}
          onClick={() => switchScope('latest')}
        >
          Latest
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
