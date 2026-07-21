import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import LoaderDots from '@/components/LoaderDots';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import VerifiedBadge from './VerifiedBadge';
import AgentBadge from './AgentBadge';
import {
  FollowCard,
  useGetFollowersQuery,
  useGetFollowingQuery,
  useToggleFollowMutation,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

/**
 * A paginated list of followers or following for a wallet. Shared by the
 * /social/[address]/followers and /following pages so both stay identical.
 * `mode` picks which query hook runs — the other is skipped. Pagination rides
 * the query's own merge: a new cursor arg appends into the same cache key.
 */
export default function FollowListView({
  address,
  mode,
}: {
  address: string;
  mode: 'followers' | 'following';
}) {
  const router = useRouter();
  const { walletAddress } = useSAGEAccount();
  const me = (walletAddress || '').toLowerCase();
  const [toggleFollow] = useToggleFollowMutation();
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  // reset paging when the target profile changes
  useEffect(() => setCursor(undefined), [address, mode]);

  const followers = useGetFollowersQuery(
    { address, cursor },
    { skip: mode !== 'followers' || !address }
  );
  const following = useGetFollowingQuery(
    { address, cursor },
    { skip: mode !== 'following' || !address }
  );
  const { data, isFetching, refetch } = mode === 'followers' ? followers : following;

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
      { rootMargin: '600px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [data?.nextCursor, isFetching]);

  const onFollow = async (u: FollowCard) => {
    try {
      await toggleFollow(u.address).unwrap();
      refetch();
    } catch {
      /* ignore */
    }
  };

  const users = data?.users || [];
  return (
    <div className='social-followlist'>
      {isFetching && !data ? (
        <LoaderDots />
      ) : users.length ? (
        <>
          {users.map((u) => (
            <div key={u.address} className='social-followlist__row'>
              <div
                className='social-followlist__avatar'
                onClick={() => router.push(`/social/${u.address}`)}
              >
                <PfpImage src={u.profilePicture} />
              </div>
              <div
                className='social-followlist__main'
                onClick={() => router.push(`/social/${u.address}`)}
              >
                <span className='social-followlist__name'>
                  {u.username ? transformTitle(u.username) : shortenAddress(u.address)}
                  {u.verified && <VerifiedBadge size={12} />}
                  {u.isAgent && <AgentBadge />}
                </span>
                <span className='social-followlist__handle'>{shortenAddress(u.address)}</span>
              </div>
              {u.address.toLowerCase() !== me && (
                <button
                  className='social-followlist__btn'
                  data-following={u.followedByViewer}
                  onClick={() => onFollow(u)}
                >
                  {u.followedByViewer ? 'Following' : 'Follow'}
                </button>
              )}
            </div>
          ))}
          <div ref={sentinelRef} className='social__sentinel' />
          {isFetching && data && <LoaderDots />}
        </>
      ) : (
        <div className='social__empty'>
          {mode === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
        </div>
      )}
    </div>
  );
}
