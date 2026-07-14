import { useRouter } from 'next/router';
import LoaderDots from '@/components/LoaderDots';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import { useGetUserMintsQuery } from '@/store/socialReducer';

/**
 * SAGE Social's own collectibles (collected posts + minted/owned NFTs) —
 * the legacy marketplace CollectionPanel above only ever knew about
 * auctions/prizes/listings, so anything picked up through SAGE Social never
 * showed up on the settings page at all.
 */
export default function SocialCollectiblesPanel() {
  const router = useRouter();
  const { walletAddress, userData } = useSAGEAccount();
  const addr = walletAddress || (userData as any)?.walletAddress || '';
  const { data, isFetching } = useGetUserMintsQuery(addr, { skip: !addr });

  if (!addr) return null;
  if (isFetching && !data) return <LoaderDots />;
  if (!data?.mints.length) return null;

  return (
    <div className='collection-panel__social'>
      <h4 className='collection-panel__social-label'>SAGE Social</h4>
      <div className='social-mints'>
        {data.mints.map((m) => {
          const img = m.image || m.post?.imageUrl || null;
          const go = () => (m.post ? router.push(`/social/post/${m.post.id}`) : undefined);
          return (
            <div key={m.ref} className='social-mints__card' onClick={go}>
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} alt='' />
              ) : (
                <p className='social-mints__text'>{m.post?.text || m.title}</p>
              )}
              <div className='social-mints__meta'>
                <span>{m.title}</span>
                <span className='social-mints__token'>#{m.tokenId}</span>
              </div>
              <div className='social-mints__paid'>
                {m.pointsSpent ? `${m.pointsSpent} pixels` : 'collected'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
