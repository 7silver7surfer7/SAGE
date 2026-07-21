import SocialShell from '@/components/Social/SocialShell';
import FaucetPanel from '@/components/Social/FaucetPanel';

/** Dedicated faucet page — once-a-day free SAGE for testing on Robinhood testnet. */
export default function FaucetPage() {
  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header'>
          <h1 className='social__title'>SAGE FAUCET</h1>
          <p className='social__subtitle'>free testnet SAGE — one claim per wallet, ever, and one per network</p>
        </header>
        <FaucetPanel />
      </div>
    </SocialShell>
  );
}
