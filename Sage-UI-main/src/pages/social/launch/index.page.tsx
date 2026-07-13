import { useEffect } from 'react';
import { useRouter } from 'next/router';
import SocialShell from '@/components/Social/SocialShell';
import LoaderDots from '@/components/LoaderDots';

/**
 * The launcher split into two dedicated pages (token / NFT). This keeps the
 * old /social/launch URL (and any bookmarks) working by forwarding to the
 * token launcher instead of 404ing.
 */
export default function LaunchIndexRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/social/launch/token');
  }, [router]);
  return (
    <SocialShell>
      <div className='social'>
        <LoaderDots />
      </div>
    </SocialShell>
  );
}
