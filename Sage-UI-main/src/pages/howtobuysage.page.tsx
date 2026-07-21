import { useRouter } from 'next/router';
import Logotype from '@/components/Logotype';
import { parameters } from '@/constants/config';
import { toast } from 'react-toastify';

const { ASHTOKEN_ADDRESS } = parameters;

// SAGE is a bonding-curve token launched through SAGE Social's own token
// launcher (SocialTokenFactory) — not a plain Uniswap listing, so "buy SAGE"
// means the token's own trading page, not an external DEX link. Pre-graduation
// there's no Uniswap pair to link to at all.
const SAGE_TOKEN_PAGE = `/social/token/${ASHTOKEN_ADDRESS}`;

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
            address: ASHTOKEN_ADDRESS, // SAGE token on Robinhood Chain
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
