import { useRouter } from 'next/router';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import { useGetMyTokenHoldingsQuery } from '@/store/socialReducer';

function fmtUsd(usd: number): string {
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`;
  return `$${usd.toFixed(2)}`;
}

function fmtBalance(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

/** The wallet's creator-coin holdings, next to the SAGE/pixel balances. */
export default function TokenHoldingsPanel() {
  const router = useRouter();
  const { walletAddress, userData } = useSAGEAccount();
  const addr = walletAddress || (userData as any)?.walletAddress || '';
  const { data, isFetching } = useGetMyTokenHoldingsQuery(addr, { skip: !addr });

  if (!addr || (!isFetching && !data?.holdings.length)) return null;

  return (
    <div className='profile-page__holdings'>
      <h4 className='profile-page__holdings-label'>your tokens</h4>
      <div className='profile-page__holdings-list'>
        {data?.holdings.map((h) => (
          <button
            key={h.tokenAddress}
            className='profile-page__holdings-row'
            onClick={() => router.push(`/social/token/${h.tokenAddress}`)}
          >
            {h.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className='profile-page__holdings-art' src={h.imageUrl} alt={h.name} />
            ) : (
              <div className='profile-page__holdings-art profile-page__holdings-art--ph'>
                ${h.symbol.slice(0, 4)}
              </div>
            )}
            <span className='profile-page__holdings-name'>
              <b>${h.symbol}</b>
              <small>{h.name}</small>
            </span>
            <span className='profile-page__holdings-value'>
              {fmtUsd(h.valueUsd)}
              <small>{fmtBalance(h.balance)} · {h.pctOfSupply.toFixed(2)}%</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
