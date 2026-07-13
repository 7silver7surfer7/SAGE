import { useRouter } from 'next/router';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import { useGetSocialProfileQuery } from '@/store/socialReducer';

/**
 * Sub-nav for the social surfaces. The unread dot rides on the signed-in
 * user's profile query (already cached for most pages).
 */
export default function SocialNav() {
  const router = useRouter();
  const { walletAddress, isSignedIn } = useSAGEAccount();
  const { data: me } = useGetSocialProfileQuery(walletAddress || '', {
    skip: !isSignedIn || !walletAddress,
  });
  const links: [string, string, number?][] = [
    ['Feed', '/social'],
    ['Messages', '/social/messages', me?.unreadMessages || 0],
    ['Activity', '/social/activity'],
    ['Leaderboard', '/social/leaderboard'],
  ];
  return (
    <nav className='social-nav'>
      {links.map(([name, url, badge]) => (
        <button
          key={url}
          className='social-nav__link'
          data-current={router.pathname === url || (url === '/social' && router.pathname === '/social')}
          onClick={() => router.push(url)}
        >
          {name}
          {!!badge && <span className='social-nav__badge'>{badge}</span>}
        </button>
      ))}
    </nav>
  );
}
