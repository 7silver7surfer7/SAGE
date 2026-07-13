import { ReactNode } from 'react';
import { useRouter } from 'next/router';
import SageFullLogoSVG from '@/public/branding/sage-full-logo.svg';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import VerifiedBadge from './VerifiedBadge';
import ReferCard from './ReferCard';
import {
  useGetSocialProfileQuery,
  useGetLeaderboardQuery,
  useGetGlobalActivityQuery,
  GlobalEvent,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

const Icon = ({ d, filled }: { d: string; filled?: boolean }) => (
  <svg width='20' height='20' viewBox='0 0 24 24' fill={filled ? 'currentColor' : 'none'} stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
    <path d={d} />
  </svg>
);
const ICONS = {
  home: 'M3 9.5L12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z',
  trophy: 'M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4zM7 4H4v2a3 3 0 0 0 3 3M17 4h3v2a3 3 0 0 1-3 3',
  hex: 'M12 2l8.5 5v10L12 22l-8.5-5V7L12 2z',
  // the Twitter compose glyph: pencil over a square
  compose: 'M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6M17.6 3.4a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 8.6-8.6z',
  rocket: 'M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8-.8-.7-2-.7-3 -.2zM12 15l-3-3a22 22 0 0 1 2-3.9A12.7 12.7 0 0 1 21.5 2.5a12.7 12.7 0 0 1-5.6 10.5A22 22 0 0 1 12 15zM9 12H4s.6-3.3 2-4.5c1.6-1.3 5 0 5 0M12 15v5s3.3-.6 4.5-2c1.3-1.6 0-5 0-5',
  palette: 'M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h1a5 5 0 0 0 5-5c0-5.5-4.5-10-10-10zM7 10a1.2 1.2 0 1 1 0-2.4A1.2 1.2 0 0 1 7 10zM12 7a1.2 1.2 0 1 1 0-2.4A1.2 1.2 0 0 1 12 7zM17 10a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z',
};

function displayNameOf(u: { username?: string | null; address: string }) {
  return u.username ? transformTitle(u.username) : shortenAddress(u.address);
}

const EVENT_VERB: Record<GlobalEvent['type'], string> = {
  tip: 'tipped',
  collect: 'collected a post by',
  boost: 'boosted a post',
  follow: 'followed',
  post: 'posted',
};

function ActivityTicker() {
  const router = useRouter();
  const { data } = useGetGlobalActivityQuery(undefined, { pollingInterval: 30_000 });
  return (
    <div className='social-widget'>
      <div className='social-widget__head'>
        <h4>ACTIVITY</h4>
        <button onClick={() => router.push('/social/activity')}>See all</button>
      </div>
      {data?.events.length ? (
        data.events.slice(0, 12).map((e, i) => (
          <div
            key={i}
            className='social-widget__event'
            onClick={() =>
              e.postId ? router.push(`/social/post/${e.postId}`) : router.push(`/social/${e.actor.address}`)
            }
          >
            <span>
              <b>{displayNameOf(e.actor)}</b> {EVENT_VERB[e.type]}{' '}
              {e.target ? <b>{displayNameOf(e.target)}</b> : ''}
              {e.amount ? (
                <span className='social-widget__amount'>
                  {' '}
                  · {e.amount} {e.currency || 'SAGE'}
                </span>
              ) : null}
            </span>
          </div>
        ))
      ) : (
        <p className='social-widget__empty'>Quiet in here — for now.</p>
      )}
    </div>
  );
}

function LeaderboardWidget() {
  const router = useRouter();
  const { data } = useGetLeaderboardQuery();
  const rows = data?.topEarners.length ? data.topEarners : data?.mostFollowed || [];
  return (
    <div className='social-widget'>
      <div className='social-widget__head'>
        <h4>LEADERBOARD</h4>
        <button onClick={() => router.push('/social/leaderboard')}>See all</button>
      </div>
      {rows.slice(0, 5).map((row, i) => (
        <div
          key={row.user?.address || i}
          className='social-widget__row'
          onClick={() => row.user && router.push(`/social/${row.user.address}`)}
        >
          <span className='social-widget__rank'>{i + 1}</span>
          <div className='social-widget__avatar'>
            <PfpImage src={row.user?.profilePicture} />
          </div>
          <span className='social-widget__name'>
            {row.user ? displayNameOf(row.user) : '—'}
            {row.user?.verified && <VerifiedBadge size={11} />}
          </span>
          <span className='social-widget__value'>
            {row.sage !== undefined ? `${row.sage}` : row.count}
          </span>
        </div>
      ))}
      {!rows.length && <p className='social-widget__empty'>First tip takes the crown.</p>}
    </div>
  );
}

/**
 * The full-page SAGE Social app shell: left sidebar (logo, nav, refer card,
 * you), center content, right rail (leaderboard + live network activity).
 * Mobile: sidebar and rail fold away, a fixed bottom tab bar takes over.
 */
export default function SocialShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { walletAddress, isSignedIn, userData } = useSAGEAccount();
  // Prefer the live wagmi address, but fall back to the signed-in session's
  // wallet so the profile chip survives the brief window where wagmi hasn't
  // re-hydrated yet (otherwise the "me" pill flickers out on every reload).
  const meAddress = walletAddress || (userData as any)?.walletAddress || '';
  const { data: me } = useGetSocialProfileQuery(meAddress, {
    skip: !meAddress,
  });

  const nav: { name: string; url: string; icon: keyof typeof ICONS; badge?: number }[] = [
    { name: 'Home', url: '/social', icon: 'home' },
    { name: 'Search', url: '/social/search', icon: 'search' },
    { name: 'Activity', url: '/social/activity', icon: 'bell' },
    { name: 'Messages', url: '/social/messages', icon: 'chat', badge: me?.unreadMessages || 0 },
    { name: 'Leaderboard', url: '/social/leaderboard', icon: 'trophy' },
    { name: 'Launch token', url: '/social/launch/token', icon: 'rocket' },
    { name: 'Launch NFT', url: '/social/launch/nft', icon: 'palette' },
    ...(meAddress
      ? [{ name: 'My mints', url: `/social/${meAddress}`, icon: 'hex' as const }]
      : []),
  ];
  const isCurrent = (url: string) =>
    url === '/social' ? router.pathname === '/social' : router.asPath.startsWith(url);

  const goNav = (url: string) => {
    // Home while already home = jump to the top of the feed (where you post)
    if (url === '/social' && router.pathname === '/social') {
      const layout = document.querySelector('.layout');
      (layout || window).scrollTo({ top: 0, behavior: 'smooth' });
      document.querySelector<HTMLTextAreaElement>('.social-composer__input')?.focus();
      return;
    }
    router.push(url);
  };

  return (
    <div className='social-shell'>
      <aside className='social-shell__sidebar'>
        <div className='social-shell__logo' onClick={() => router.push('/social')}>
          <SageFullLogoSVG />
          <span>SOCIAL</span>
        </div>
        <nav className='social-shell__nav'>
          {nav.map((item) => (
            <button
              key={item.name}
              className='social-shell__nav-item'
              data-current={isCurrent(item.url)}
              onClick={() => goNav(item.url)}
            >
              <Icon d={ICONS[item.icon]} />
              <span>{item.name}</span>
              {!!item.badge && <span className='social-nav__badge'>{item.badge}</span>}
            </button>
          ))}
        </nav>
        {isSignedIn && (
          <button
            className='social-shell__post-btn'
            onClick={() => router.push('/social/compose')}
          >
            <Icon d={ICONS.compose} /> Post
          </button>
        )}
        {meAddress && (
          <button
            className='social-shell__me'
            title='View your profile'
            onClick={() => router.push(`/social/${meAddress}`)}
          >
            <div className='social-shell__me-avatar' data-verified={me?.pfpVerified}>
              <PfpImage src={userData?.profilePicture || me?.profilePicture} />
            </div>
            <span className='social-shell__me-main'>
              <span className='social-shell__me-name'>
                {me?.username ? transformTitle(me.username) : shortenAddress(meAddress)}
                {me?.verified && <VerifiedBadge size={12} />}
              </span>
              <span className='social-shell__me-sub'>View profile</span>
            </span>
          </button>
        )}
        {isSignedIn && <ReferCard />}
      </aside>

      <main className='social-shell__main'>{children}</main>

      <aside className='social-shell__rail'>
        <LeaderboardWidget />
        <ActivityTicker />
      </aside>

      {isSignedIn && (
        <button
          className='social-shell__fab'
          onClick={() => router.push('/social/compose')}
          aria-label='New post'
          title='New post'
        >
          <Icon d={ICONS.compose} />
        </button>
      )}

      <nav className='social-shell__tabbar'>
        {nav.slice(0, 5).map((item) => (
          <button
            key={item.name}
            data-current={isCurrent(item.url)}
            onClick={() => goNav(item.url)}
            aria-label={item.name}
          >
            <Icon d={ICONS[item.icon]} />
            {!!item.badge && <span className='social-nav__badge'>{item.badge}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
