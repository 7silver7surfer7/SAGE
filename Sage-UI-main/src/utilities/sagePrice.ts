import { ethers } from 'ethers';
import {
  SAGE_PRICE_RPC_URL,
  SAGE_PRICE_CHAIN_ID,
  SAGE_PRICE_PAIR_ADDRESS,
  SAGE_PRICE_TOKEN_ADDRESS,
} from '@/constants/config';

// SAGE lives on Robinhood Chain, which DexScreener does not index — so the old
// DexScreener lookups always returned an empty result (blank price / $0 USD).
// Instead we read the price straight from the token's on-chain Uniswap-v2
// SAGE/WETH pair on Robinhood mainnet and convert to USD with the live ETH/USD
// rate:
//
//   priceUsd(SAGE) = (WETH reserve / SAGE reserve) * USD-per-ETH
//
// Both SAGE and WETH use 18 decimals, so the reserve ratio is unitless.
// Server-side only (uses an RPC provider + an external ETH/USD feed).

const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
];

// Uniswap v2 USDC/WETH pair on Ethereum mainnet — the canonical on-chain
// ETH/USD rate. Read via a public RPC; token order confirmed dynamically.
const UNISWAP_USDC_WETH_PAIR = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc';
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
// keyless public RPCs, tried in order (cloudflare-eth rejects eth_call lately)
const ETH_MAINNET_RPCS = ['https://ethereum-rpc.publicnode.com', 'https://cloudflare-eth.com'];

export async function getEthUsd(): Promise<number> {
  // Primary: Uniswap (on-chain, no API key).
  for (const url of ETH_MAINNET_RPCS) {
    try {
      const provider = new ethers.providers.StaticJsonRpcProvider(url, 1);
      const pair = new ethers.Contract(UNISWAP_USDC_WETH_PAIR, PAIR_ABI, provider);
      const [reserves, token0] = await Promise.all([pair.getReserves(), pair.token0()]);
      const usdcIsToken0 = token0.toLowerCase() === USDC_ADDRESS.toLowerCase();
      const usdcReserve = usdcIsToken0 ? reserves.reserve0 : reserves.reserve1;
      const wethReserve = usdcIsToken0 ? reserves.reserve1 : reserves.reserve0;
      const usdc = Number(ethers.utils.formatUnits(usdcReserve, 6));
      const weth = Number(ethers.utils.formatUnits(wethReserve, 18));
      if (usdc > 0 && weth > 0) return usdc / weth;
    } catch {
      // this RPC is down → try the next, then CoinGecko
    }
  }
  // Fallback: CoinGecko's free simple-price endpoint (no key).
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
  );
  const json = await res.json();
  const ethUsd = Number(json?.ethereum?.usd);
  if (!Number.isFinite(ethUsd) || ethUsd <= 0) throw new Error('ETH/USD unavailable');
  return ethUsd;
}

export async function getSagePriceUsd(): Promise<number> {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    SAGE_PRICE_RPC_URL,
    SAGE_PRICE_CHAIN_ID
  );
  const pair = new ethers.Contract(SAGE_PRICE_PAIR_ADDRESS, PAIR_ABI, provider);

  const [reserves, token0, ethUsd] = await Promise.all([
    pair.getReserves(),
    pair.token0(),
    getEthUsd(),
  ]);

  const sageIsToken0 = token0.toLowerCase() === SAGE_PRICE_TOKEN_ADDRESS.toLowerCase();
  const sageReserve = sageIsToken0 ? reserves.reserve0 : reserves.reserve1;
  const wethReserve = sageIsToken0 ? reserves.reserve1 : reserves.reserve0;

  const sage = Number(ethers.utils.formatUnits(sageReserve, 18));
  const weth = Number(ethers.utils.formatUnits(wethReserve, 18));
  if (!(sage > 0) || !(weth > 0)) throw new Error('empty SAGE/WETH pair reserves');

  return (weth / sage) * ethUsd;
}
