import useSAGEAccount from '@/hooks/useSAGEAccount';
import ReactTooltip from 'react-tooltip';

export default function Balances() {
  const { pointsBalanceDisplay, ashBalance, ashBalanceDisplay } = useSAGEAccount();
  // if (!pointsBalanceDisplay || !ashBalanceDisplay) {
  //   return null;
  // }
  const pixelRate = getPixelRate(ashBalance);
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

// 0.01 pixels/day per SAGE, reward capped at 5,000,000 SAGE (= 50,000 pixels/day)
// — matches SagePoints.economics() on-chain (rateScaled=1, capSage=5_000_000)
function getPixelRate(sageBalance: number) {
  if (isNaN(sageBalance) || sageBalance == 0) {
    return 0;
  }
  const rate = sageBalance / 100;
  return rate > 50000 ? 50000 : rate.toFixed(1);
}
