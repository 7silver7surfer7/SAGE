import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { ethers } from 'ethers';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const loadAbi = (name) => JSON.parse(readFileSync(path.join(here, 'abis', `${name}.json`), 'utf8')).abi;

export const ABIS = {
  openEdition: loadAbi('SAGEOpenEdition'),
  lottery: loadAbi('Lottery'),
  auction: loadAbi('Auction'),
  collection: loadAbi('SageCollection'),
  erc20: loadAbi('ERC20Standard'),
  weth: ['function deposit() payable', 'function transfer(address to, uint256 value) returns (bool)', 'function balanceOf(address) view returns (uint256)'],
  pair: [
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() view returns (address)',
    'function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)',
  ],
  // SocialTokenFactory (bonding-curve trading, pre-graduation) — same buy/sell
  // shape as swapRouter below, deliberately, so callers barely branch.
  curveFactory: [
    'function curves(address token) view returns (uint256 virtualTokenReserves, uint256 virtualEthReserves, uint256 realTokenReserves, uint256 realEthReserves, address creator, bool complete, bool airdropEnabled)',
    'function spotPriceWei(address token) view returns (uint256)',
    'function quoteBuy(address token, uint256 ethInAfterFee) view returns (uint256)',
    'function buy(address token, uint256 minTokensOut) payable',
    'function sell(address token, uint256 amount, uint256 minEthOut)',
    'function pairOf(address token) view returns (address)',
  ],
  // SageSwapRouter (post-graduation trading against the real Uniswap pair).
  swapRouter: [
    'function poolPriceWei(address token) view returns (uint256)',
    'function quoteBuy(address token, uint256 ethIn) view returns (uint256)',
    'function buy(address token, uint256 minTokensOut) payable',
    'function sell(address token, uint256 amountIn, uint256 minEthOut)',
  ],
};

export const marketplaceProvider = new ethers.providers.StaticJsonRpcProvider(
  config.marketplace.rpcUrl,
  config.marketplace.chainId
);
export const dexProvider = new ethers.providers.StaticJsonRpcProvider(
  config.dex.rpcUrl,
  config.dex.chainId
);

// Robinhood Chain gas is ~0.01 gwei, but ethers defaults to EIP-1559 with a
// 1.5 gwei priority fee. That inflates maxFeePerGas ~150x, so for a heavy tx
// (e.g. a pixel-claim mint, ~420k gas) on a lightly-funded wallet the UPFRONT
// reservation (gasLimit * maxFeePerGas) exceeds the balance and the tx fails
// with "insufficient funds" / "cannot estimate gas" — even though the real cost
// is a few millionths of an ETH. Force legacy (type-0) pricing at the actual
// network gas price so every write the MCP sends stays affordable.
function useLegacyGasPricing(provider) {
  const getGasPrice = provider.getGasPrice.bind(provider);
  provider.getFeeData = async () => {
    const gasPrice = await getGasPrice();
    return { gasPrice, maxFeePerGas: null, maxPriorityFeePerGas: null, lastBaseFeePerGas: null };
  };
}
useLegacyGasPricing(marketplaceProvider);
useLegacyGasPricing(dexProvider);

export function requireWallet(provider) {
  if (!config.agentPrivateKey) {
    throw new Error(
      'SAGE_AGENT_PRIVATE_KEY is not set — transaction tools need the agent wallet. Read-only tools still work.'
    );
  }
  return new ethers.Wallet(config.agentPrivateKey, provider);
}

export function agentAddress() {
  if (!config.agentPrivateKey) return null;
  return new ethers.Wallet(config.agentPrivateKey).address;
}

/** approve `spender` for exactly `amount` of SAGE if allowance is short */
export async function ensureSageAllowance(wallet, spender, amount) {
  const sage = new ethers.Contract(config.marketplace.sageToken, ABIS.erc20, wallet);
  const allowance = await sage.allowance(wallet.address, spender);
  if (allowance.gte(amount)) return null;
  const tx = await sage.approve(spender, amount);
  await tx.wait(1);
  return tx.hash;
}

export const fmt = (bn, decimals = 18) => ethers.utils.formatUnits(bn, decimals);
export const parse = (v, decimals = 18) => ethers.utils.parseUnits(String(v), decimals);

// Sentinel used across every SAGE game contract to mean "priced in native ETH,
// not the SAGE ERC-20" — address(0) is reserved for SAGE itself.
export const NATIVE_CURRENCY = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const isNativeCurrency = (addr) =>
  typeof addr === 'string' && addr.toLowerCase() === NATIVE_CURRENCY.toLowerCase();
