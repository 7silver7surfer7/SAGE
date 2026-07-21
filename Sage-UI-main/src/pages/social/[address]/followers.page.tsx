import { useRouter } from 'next/router';
import SocialShell from '@/components/Social/SocialShell';
import FollowListView from '@/components/Social/FollowListView';

export default function FollowersPage() {
  const router = useRouter();
  const address = typeof router.query.address === 'string' ? router.query.address : '';
  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header'>
          <button className='social__back' onClick={() => router.push(`/social/${address}`)}>
            ← Back to profile
          </button>
          <h1 className='social__title'>FOLLOWERS</h1>
        </header>
        {address && <FollowListView address={address} mode='followers' />}
      </div>
    </SocialShell>
  );
}
