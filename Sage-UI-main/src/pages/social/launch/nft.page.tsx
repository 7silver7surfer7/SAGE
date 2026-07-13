import SocialShell from '@/components/Social/SocialShell';
import EditionPanel from '@/components/Social/EditionPanel';
import useSAGEAccount from '@/hooks/useSAGEAccount';

/** Launch an NFT edition or a ZIP collection. */
export default function LaunchNftPage() {
  const { walletAddress } = useSAGEAccount();
  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header'>
          <h1 className='social__title'>LAUNCH NFT</h1>
          <p className='social__subtitle'>
            an edition or a ZIP collection — free to launch, 1% of each mint to the platform
          </p>
        </header>
        {walletAddress ? (
          <EditionPanel address={walletAddress} isSelf />
        ) : (
          <div className='social__empty'>Connect your wallet to launch an NFT.</div>
        )}
      </div>
    </SocialShell>
  );
}
