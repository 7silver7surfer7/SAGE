import SocialShell from '@/components/Social/SocialShell';
import TokenPanel from '@/components/Social/TokenPanel';
import EditionPanel from '@/components/Social/EditionPanel';
import useSAGEAccount from '@/hooks/useSAGEAccount';

/** The launchpad hub: your creator coin and NFT editions in one place. */
export default function LaunchPage() {
  const { walletAddress, isSignedIn } = useSAGEAccount();
  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header'>
          <h1 className='social__title'>LAUNCH</h1>
          <p className='social__subtitle'>
            creator coins on the pump.fun curve · NFT editions — free to launch, 1% on volume
          </p>
        </header>
        {!isSignedIn || !walletAddress ? (
          <div className='social__empty'>Connect your wallet to launch.</div>
        ) : (
          <>
            <TokenPanel address={walletAddress} isSelf followers={[]} />
            <EditionPanel address={walletAddress} isSelf />
          </>
        )}
      </div>
    </SocialShell>
  );
}
