import { useState } from 'react';
import { useRouter } from 'next/router';
import LoaderDots from '@/components/LoaderDots';
import SocialShell from '@/components/Social/SocialShell';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { useGetLeaderboardQuery, LeaderboardRow } from '@/store/socialReducer';

const BOARDS = [
  ['topPoints', 'Top points', 'net pixels — earned holding SAGE, spent/earned collecting posts'],
  ['topEarners', 'Top earners', 'SAGE tipped to their posts'],
  ['topTippers', 'Top tippers', 'SAGE they tipped to others'],
  ['topBurners', 'Top boosters', 'ETH spent boosting posts'],
  ['mostFollowed', 'Most followed', 'followers'],
] as const;

export default function LeaderboardPage() {
  const router = useRouter();
  const [board, setBoard] = useState<(typeof BOARDS)[number][0]>('topPoints');
  const { data, isFetching } = useGetLeaderboardQuery();
  const rows: LeaderboardRow[] = (data as any)?.[board] || [];
  const meta = BOARDS.find(([k]) => k === board)!;

  return (
    <SocialShell>
    <div className='social'>
      <header className='social__header'>
        <h1 className='social__title'>LEADERBOARD</h1>
        <p className='social__subtitle'>the SAGE Social economy, ranked</p>
      </header>
      {data?.stats && (
        <div className='social-lb-stats'>
          <div>
            <b>{data.stats.totalUsers.toLocaleString()}</b>
            <span>users</span>
          </div>
          <div>
            <b>{data.stats.tokenVolumeEth.toFixed(4)} ETH</b>
            <span>token volume</span>
          </div>
          <div>
            <b>{data.stats.nftVolumeEth.toFixed(4)} ETH</b>
            <span>NFT volume</span>
          </div>
          <div>
            <b>{data.stats.nftVolumePixels.toLocaleString()}</b>
            <span>pixels spent on art</span>
          </div>
        </div>
      )}
      <div className='social__tabs'>
        {BOARDS.map(([key, label]) => (
          <button
            key={key}
            className={`social__tab ${board === key ? 'social__tab--active' : ''}`}
            onClick={() => setBoard(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {isFetching && !data ? (
        <LoaderDots />
      ) : rows.length ? (
        <div className='social-board'>
          {rows.map((row, i) => (
            <div
              key={row.user?.address || i}
              className='social-board__row'
              onClick={() => row.user && router.push(`/social/${row.user.address}`)}
            >
              <span className='social-board__rank' data-top={i < 3}>
                {i + 1}
              </span>
              <div className='social-board__avatar'>
                <PfpImage src={row.user?.profilePicture} />
              </div>
              <span className='social-board__name'>
                {row.user?.username
                  ? transformTitle(row.user.username)
                  : shortenAddress(row.user?.address || '')}
                {row.user?.verified && <VerifiedBadge size={12} />}
              </span>
              <span className='social-board__value'>
                {board === 'mostFollowed'
                  ? `${row.count} followers`
                  : board === 'topPoints'
                  ? `${row.count} pixels`
                  : `${row.sage} SAGE`}
              </span>
            </div>
          ))}
          <p className='social-board__caption'>{meta[2]}</p>
        </div>
      ) : (
        <div className='social__empty'>No data yet — the economy starts with the first tip.</div>
      )}
    </div>
    </SocialShell>
  );
}
