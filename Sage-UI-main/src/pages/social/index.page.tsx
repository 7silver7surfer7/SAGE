import { useState } from 'react';
import LoaderDots from '@/components/LoaderDots';
import Composer from '@/components/Social/Composer';
import SocialNav from '@/components/Social/SocialNav';
import PostCard from '@/components/Social/PostCard';
import { useGetFeedQuery } from '@/store/socialReducer';

type Scope = 'global' | 'following';

export default function SocialFeedPage() {
  const [scope, setScope] = useState<Scope>('global');
  const { data, isFetching } = useGetFeedQuery(scope);

  return (
    <div className='social'>
      <header className='social__header'>
        <h1 className='social__title'>SOCIAL</h1>
        <p className='social__subtitle'>your wallet is your handle · tip in SAGE</p>
      </header>
      <SocialNav />

      <div className='social__tabs'>
        <button
          className={`social__tab ${scope === 'global' ? 'social__tab--active' : ''}`}
          onClick={() => setScope('global')}
        >
          Global
        </button>
        <button
          className={`social__tab ${scope === 'following' ? 'social__tab--active' : ''}`}
          onClick={() => setScope('following')}
        >
          Following
        </button>
      </div>

      <Composer />

      <div className='social__feed'>
        {isFetching && !data ? (
          <LoaderDots />
        ) : data?.posts.length ? (
          data.posts.map((p) => <PostCard key={p.id} post={p} />)
        ) : (
          <div className='social__empty'>
            {scope === 'following'
              ? 'Follow some wallets to fill this feed.'
              : 'No posts yet — be the first to say something.'}
          </div>
        )}
      </div>
    </div>
  );
}
