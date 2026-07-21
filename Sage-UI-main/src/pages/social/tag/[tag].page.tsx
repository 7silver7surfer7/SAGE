import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import LoaderDots from '@/components/LoaderDots';
import SocialShell from '@/components/Social/SocialShell';
import PostCard from '@/components/Social/PostCard';
import { useGetHashtagFeedQuery } from '@/store/socialReducer';

export default function HashtagPage() {
  const router = useRouter();
  const tag = typeof router.query.tag === 'string' ? router.query.tag.toLowerCase() : '';
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  useEffect(() => setCursor(undefined), [tag]);

  const { data, isFetching } = useGetHashtagFeedQuery(
    { tag, cursor },
    { skip: !tag, refetchOnMountOrArgChange: true }
  );
  const sentinelRef = useRef<HTMLDivElement>(null);

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
          <h1 className='social__title'>#{tag}</h1>
          <p className='social__subtitle'>everything tagged #{tag}</p>
        </header>
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
            </>
          ) : (
            <div className='social__empty'>No posts with #{tag} yet.</div>
          )}
        </div>
      </div>
    </SocialShell>
  );
}
