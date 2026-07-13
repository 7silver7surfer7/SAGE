import SocialShell from '@/components/Social/SocialShell';
import TokenPanel from '@/components/Social/TokenPanel';
import useSAGEAccount from '@/hooks/useSAGEAccount';

/** Launch a creator coin on the pump.fun-style bonding curve. */
export default function LaunchTokenPage() {
  const { walletAddress, userData } = useSAGEAccount();
  // survive the wagmi rehydration window: fall back to the session's wallet
  const addr = walletAddress || (userData as any)?.walletAddress || '';
  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header'>
          <h1 className='social__title'>LAUNCH TOKEN</h1>
          <p className='social__subtitle'>
            a creator coin on the pump.fun curve — free to launch, 1% on volume
          </p>
        </header>
        {addr ? (
          <TokenPanel address={addr} isSelf followers={[]} />
        ) : (
          <div className='social__empty'>Connect your wallet to launch a token.</div>
        )}
      </div>
    </SocialShell>
  );
}
