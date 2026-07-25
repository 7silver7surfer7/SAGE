import { useRouter } from 'next/router';
import Logotype from '@/components/Logotype';
import { SAGE_V2_TOKEN_ADDRESS } from '@/constants/config';
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

// NOT /social/token/<address>. That page is registry-backed — getTokenDetail
// does socialTokenLaunch.findUnique — and this token was launched through
// Doppler, not SocialTokenFactory, so it has no row and the page 404s. Linking
// there would look right and be broken. The explorer works today; the native
// page can take over once it can read a v4 pool (see utilities/uniswapV4.ts).
const SAGE_TOKEN_PAGE = `https://robinhoodchain.blockscout.com/token/${SAGE_TOKEN_ADDRESS}`;

export default function howtobuysage() {
  const router = useRouter();
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
        <button
          onClick={() => router.push(SAGE_TOKEN_PAGE)}
          className='howtobuyash__import-button'
        >
          BUY SAGE
        </button>
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
              onClick={(e) => {
                e.preventDefault();
                router.push(SAGE_TOKEN_PAGE);
              }}
              className='howtobuyash-text-link'
            >
              SAGE token page
            </a>{' '}
            — SAGE trades on its own bonding curve there, not a Uniswap listing.
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
        tokens. You will earn 0.25 Pixels a day per SAGE. This reward is capped at 100,000 SAGE
        and will earn you 25,000 Pixels a day.
      </p>
    </div>
  );
}
