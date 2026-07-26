import { pixelsPerDay } from '@/constants/pixels';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import { useGetEarnedPointsQuery } from '@/store/pointsReducer';
import ReactTooltip from 'react-tooltip';

export default function Balances() {
  const { pointsBalanceDisplay, ashBalanceDisplay, pixelEarningBalance } = useSAGEAccount();
  /**
   * THE SERVER'S RATE WINS, because it is the only one that knows about
   * linked wallets.
   *
   * useSAGEAccount reads `balanceOf` for the CONNECTED wallet only. It gets
   * the two-TOKEN rule right (max, never sum) — its comment claims it "mirrors
   * liveSageWhole exactly" — but liveSageWhole also sums across every
   * LinkedWallet, and nothing about linking ever reaches this hook. So a
   * holder whose balance lives in a linked Privy wallet is shown 0/day while
   * /api/pixels-link replies pixelsPerDay: 25000 and the ledger pays them
   * 25,000. Unlike the checkpoint-proxy drift elsewhere, this never
   * self-corrects.
   *
   * /api/points already returns dbDailyRate's answer and pointsReducer simply
   * discarded it. The local computation stays as the fallback for the
   * disconnected/loading case, where there is no server answer to use.
   */
  const { data: earned } = useGetEarnedPointsQuery();
  const serverRate = Number(earned?.dailyRate);
  const pixelRate = Number.isFinite(serverRate)
    ? serverRate.toFixed(1)
    : getPixelRate(pixelEarningBalance);
  const tooltip = `You are currently earning ${pixelRate} pixels per day`;
  return (
    <div className='profile-page__balances'>
      <ReactTooltip
        id='main'
        // stable uuid: the default is randomized per render, so SSR and client
        // markup never match and React 18 hydration fails on /profile
        uuid='sage-balances-tooltip'
        place={'bottom'}
        type={'light'}
        effect={'solid'}
        multiline={true}
        offset={{ bottom: 40 }}
      />
      <div className='profile-page__balances-token'>
        <h1 className='profile-page__balances-token-value'>{ashBalanceDisplay}</h1>
        <h1 className='profile-page__balances-points-label'>your sage balance</h1>
      </div>
      <div className='profile-page__balances-points'>
        <h1 className='profile-page__balances-points-value'>
          <span data-for='main' data-tip={tooltip} data-iscapture='true'>
            {pointsBalanceDisplay}
          </span>
        </h1>
        <h1 className='profile-page__balances-points-label'>your pixel balance</h1>
      </div>
    </div>
  );
}

// Reads the SAME constants the accrual ledger uses. This used to hardcode
// `Math.min(balance, 100000) * 0.25`, which was correct for the old token and
// would have silently overstated the rate by 250x once accrual moved.
function getPixelRate(sageBalance: number) {
  if (isNaN(sageBalance) || sageBalance == 0) {
    return 0;
  }
  return pixelsPerDay(sageBalance).toFixed(1);
}
