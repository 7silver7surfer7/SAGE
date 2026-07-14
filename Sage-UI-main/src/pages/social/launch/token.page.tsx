import SocialShell from '@/components/Social/SocialShell';
import TokenPanel from '@/components/Social/TokenPanel';
import VerificationModal from '@/components/Social/VerificationModal';
import { useState } from 'react';
import useSAGEAccount from '@/hooks/useSAGEAccount';

/** Launch a creator coin on the pump.fun-style bonding curve. */
export default function LaunchTokenPage() {
  const { walletAddress, userData } = useSAGEAccount();
  const viewerVerified = !!(userData as any)?.verifiedAt;
  const [showVerify, setShowVerify] = useState(false);
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
        {!addr ? (
          <div className='social__empty'>Connect your wallet to launch a token.</div>
        ) : !viewerVerified ? (
          <div
            className='social-launch__done'
            style={{ cursor: 'pointer' }}
            onClick={() => setShowVerify(true)}
          >
            <h3>Launching is a verified perk</h3>
            <p>Get the $10 checkmark to launch your creator coin. Tap to get verified.</p>
          </div>
        ) : (
          <TokenPanel address={addr} isSelf followers={[]} />
        )}
        {showVerify && <VerificationModal onClose={() => setShowVerify(false)} />}
      </div>
    </SocialShell>
  );
}
