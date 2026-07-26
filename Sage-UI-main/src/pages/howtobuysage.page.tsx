import Logotype from '@/components/Logotype';
import PixelsWalletLink from '@/components/PixelsWalletLink';
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

// Uniswap's own token page, where SAGE can actually be SWAPPED.
//
// NOT /social/token/<address>: that page is registry-backed — getTokenDetail
// does socialTokenLaunch.findUnique — and this token launched through Doppler,
// not SocialTokenFactory, so it has no row and 404s. Linking there would look
// right and be broken.
//
// It previously pointed at the block explorer, which proves the token exists
// but cannot buy it — a "BUY SAGE" button landing on a read-only contract page
// is a dead end for the one thing this page is for.
//
// Lowercased deliberately: Uniswap's route is case-sensitive and a checksummed
// address 404s there.
const SAGE_SWAP_URL = `https://app.uniswap.org/explore/tokens/robinhood/${SAGE_TOKEN_ADDRESS.toLowerCase()}`;

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
          href={SAGE_SWAP_URL}
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
              href={SAGE_SWAP_URL}
              target='_blank'
              rel='noreferrer'
              className='howtobuyash-text-link'
            >
              SAGE page on Uniswap
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
      <PixelsWalletLink />
    </div>
  );
}
