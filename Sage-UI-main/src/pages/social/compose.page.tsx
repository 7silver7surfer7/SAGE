import { useRouter } from 'next/router';
import SocialShell from '@/components/Social/SocialShell';
import Composer from '@/components/Social/Composer';

/** Dedicated compose page — the FAB and the mobile tab bar land here. */
export default function ComposePage() {
  const router = useRouter();
  const quoteId = typeof router.query.quote === 'string' ? Number(router.query.quote) : undefined;
  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header'>
          <h1 className='social__title'>{quoteId ? 'QUOTE POST' : 'NEW POST'}</h1>
          <p className='social__subtitle'>
            {quoteId ? 'add your take — the original shows as a card' : 'text, images or video — 500 characters'}
          </p>
        </header>
        <Composer
          key={String(router.query.draft || '') + String(quoteId || '')}
          autoFocus
          quotedPostId={quoteId}
          initialText={typeof router.query.draft === 'string' ? router.query.draft : ''}
          onPosted={() => router.push('/social')}
        />
      </div>
    </SocialShell>
  );
}
