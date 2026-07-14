import Logotype from '@/components/Logotype';
import { parameters } from '@/constants/config';
import { toast } from 'react-toastify';

const { ASHTOKEN_ADDRESS } = parameters;

const UNISWAP_SAGE_URL =
  'https://app.uniswap.org/explore/tokens/robinhood/0x08deaa8250beAeD65366fbbde0088E76261637bA';

export default function howtobuyash() {
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
        <button onClick={handleImportSAGE} className='howtobuyash__import-button'>
          IMPORT SAGE TO WALLET
        </button>
        <div className='howtobuyash__group'>
          <span className='howtobuyash-bullet'>Step 1</span>
          <p>
            Go to{' '}
            <a href={UNISWAP_SAGE_URL} target='_blank' className='howtobuyash-text-link'>
              Uniswap
            </a>{' '}
            to exchange ETH for SAGE on Robinhood Chain.
          </p>
        </div>
        <div className='howtobuyash__group'>
          <span className='howtobuyash-bullet'>Step 2</span>
          <p>Connect your wallet to the site.</p>
        </div>
        <div className='howtobuyash__group'>
          <span className='howtobuyash-bullet'>Step 3</span>
          <p>Enter the desired amount of SAGE you are purchasing. </p>
        </div>

        <div className='howtobuyash__group'>
          <span className='howtobuyash-bullet'>Step 4</span>
          <p>Hit Swap to confirm the exchange with Uniswap.</p>
        </div>
      </div>
      <div className='howtobuyash-header'>Earning Pixels </div>
      <p className='howtobuyash__earning-pixels-info'>
        When connecting to the platform, you immediately start earning pixels if you have SAGE
        tokens. You will earn .25 Pixels a day per SAGE. This reward is capped at 1,000,000 SAGE
        and will earn you 250,000 Pixels a day.
      </p>
    </div>
  );
}
