import Logotype from '@/components/Logotype';
import {
  SAGE_V2_TOKEN_ADDRESS,
  PIXELS_LEGACY_TOKEN_ADDRESS,
  PIXELS_MIGRATION_ENDS_AT,
} from '@/constants/config';
import { toast } from 'react-toastify';

// The CURRENT SAGE token. The original (0x1456…) was a bonding-curve launch
// through SocialTokenFactory that graduated to a Uniswap v2 pair; this one is
// a Doppler launch trading on Uniswap v4, so it has no v2 pair to link to and
// the v2-shaped surfaces cannot price it — see utilities/uniswapV4.ts.
//
// Only this page and the wallet import point here so far. ASHTOKEN_ADDRESS and
// points accrual still reference the original on purpose: repointing those
// before holders have migrated would strand the 284 holders who hold it.
const SAGE_TOKEN_ADDRESS = SAGE_V2_TOKEN_ADDRESS;

// Shown on the page because the migration window is the thing a holder of the
// old token most needs to know, and this is the page they read to buy.
const LEGACY_SAGE_SHORT = `${PIXELS_LEGACY_TOKEN_ADDRESS.slice(0, 6)}…${PIXELS_LEGACY_TOKEN_ADDRESS.slice(-4)}`;
const MIGRATION_ENDS_LABEL = PIXELS_MIGRATION_ENDS_AT.toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

// NOT /social/token/<address>. That page is registry-backed — getTokenDetail
// does socialTokenLaunch.findUnique — and this token was launched through
// Doppler, not SocialTokenFactory, so it has no row and the page 404s. Linking
// there would look right and be broken. The explorer works today; the native
// page can take over once it can read a v4 pool (see utilities/uniswapV4.ts).
const SAGE_TOKEN_PAGE = `https://robinhoodchain.blockscout.com/token/${SAGE_TOKEN_ADDRESS}`;

export default function howtobuysage() {
  async function handleImportSAGE() {
    try {
      // wasAdded is a boolean. Like any RPC method, an error may be thrown.
      const wasAdded = await window.ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: SAGE_TOKEN_ADDRESS, // SAGE on Robinhood Chain (Uniswap v4)
            symbol: 'SAGE',
            decimals: 18,
          },
        },
      });

      if (wasAdded) {
        toast.success('Successfully added token to wallet!');
      } else {
        toast.error('Error adding token to wallet');
      }
    } catch (error) {
      console.log(error);
    }
  }
  return (
    <div className='howtobuyash'>
      <Logotype></Logotype>
      <div className='howtobuyash-header'>How to buy SAGE </div>
      <div className='howtobuyash-text'>
        <a
          href={SAGE_TOKEN_PAGE}
          target='_blank'
          rel='noreferrer'
          className='howtobuyash__import-button'
        >
          BUY SAGE
        </a>
        <button onClick={handleImportSAGE} className='howtobuyash__import-button'>
          IMPORT SAGE TO WALLET
        </button>
        <div className='howtobuyash__group'>
          <span className='howtobuyash-bullet'>Step 1</span>
          <p>Connect your wallet to the site.</p>
        </div>
        <div className='howtobuyash__group'>
          <span className='howtobuyash-bullet'>Step 2</span>
          <p>
            Go to the{' '}
            <a
              href={SAGE_TOKEN_PAGE}
              target='_blank'
              rel='noreferrer'
              className='howtobuyash-text-link'
            >
              SAGE token page
            </a>{' '}
            — SAGE trades in a Uniswap v4 pool on Robinhood Chain.
          </p>
        </div>
        <div className='howtobuyash__group'>
          <span className='howtobuyash-bullet'>Step 3</span>
          <p>Enter the amount of ETH you want to spend.</p>
        </div>

        <div className='howtobuyash__group'>
          <span className='howtobuyash-bullet'>Step 4</span>
          <p>Hit Buy to confirm — SAGE lands straight in your wallet.</p>
        </div>
      </div>
      <div className='howtobuyash-header'>Earning Pixels </div>
      <p className='howtobuyash__earning-pixels-info'>
        When connecting to the platform, you immediately start earning pixels if you have SAGE
        tokens. You will earn 0.001 Pixels a day per SAGE. This reward is capped at 25,000,000
        SAGE and will earn you 25,000 Pixels a day.
      </p>
      <p className='howtobuyash__earning-pixels-info'>
        Holding the previous SAGE token ({LEGACY_SAGE_SHORT}) still earns until{' '}
        {MIGRATION_ENDS_LABEL}, at the rate it always did — 0.25 Pixels a day per token, capped
        at 100,000. Holding both does not earn twice: whichever token would earn you more is the
        one that counts. After that date only the token above earns.
      </p>
    </div>
  );
}
