import { useRouter } from 'next/router';
import SocialShell from '@/components/Social/SocialShell';
import Composer from '@/components/Social/Composer';

/** Dedicated compose page — the FAB and the mobile tab bar land here. */
export default function ComposePage() {
  const router = useRouter();
  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header'>
          <h1 className='social__title'>NEW POST</h1>
          <p className='social__subtitle'>text, images or video — 500 characters</p>
        </header>
        <Composer autoFocus onPosted={() => router.push('/social')} />
      </div>
    </SocialShell>
  );
}
