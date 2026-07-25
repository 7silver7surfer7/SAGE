import { ethers, Signer } from 'ethers';
import {
  V4_QUOTER,
  V4_STATE_VIEW,
  V4_UNIVERSAL_ROUTER,
  V4_POOL_MANAGER,
  TRADE_WETH_ADDRESS,
  SAGE_V2_TOKEN_ADDRESS,
} from '@/constants/config';

/**
 * Uniswap v4 support.
 *
 * Every other venue in this codebase speaks v2: a pair contract per market,
 * with getReserves() and a fee you can pin down. v4 has none of that — all
 * pools are state inside one PoolManager singleton, addressed by a PoolKey,
 * and the fee can be set per-swap by a hook. A v4 token therefore reads as
 * "no market" to the v2 resolvers, which is exactly why the second SAGE looked
 * unlisted while holding 1.09e24 of liquidity.
 *
 * Two consequences shape this file:
 *
 * 1. THE FEE CANNOT BE DERIVED. The pool's fee field is 0x800000, the dynamic
 *    flag, so the hook decides. The trick used for the v2 router — reproduce
 *    quoteBuy with constant-product maths and solve for the fee — is
 *    impossible here. Quotes MUST come from the on-chain quoter.
 * 2. THE QUOTER IS NOT A VIEW. V4Quoter simulates the swap and reverts to
 *    return its result, so every quote goes through callStatic.
 */

/** PoolKey — the identity of a v4 pool. Currency order is enforced by v4. */
export interface PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

const QUOTER_ABI = [
  'function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)',
];
const STATE_VIEW_ABI = [
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128)',
];
const UNIVERSAL_ROUTER_ABI = [
  'function execute(bytes commands,bytes[] inputs,uint256 deadline) payable',
];

/** UniversalRouter command bytes. */
const CMD_WRAP_ETH = 0x0b;
const CMD_V4_SWAP = 0x10;
/** v4-periphery Actions. */
const ACT_SWAP_EXACT_IN_SINGLE = 0x06;
const ACT_SETTLE_ALL = 0x0c;
const ACT_TAKE_ALL = 0x0f;
/** UniversalRouter address sentinels. */
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002';
const MSG_SENDER = '0x0000000000000000000000000000000000000001';

/**
 * Known v4 pools, by base token.
 *
 * A registry rather than discovery-on-demand: finding a PoolKey means scanning
 * Initialize events, and this chain's RPC caps eth_getLogs at ~2,000 blocks,
 * so a cold lookup is thousands of requests. These were recovered that way once
 * and pinned. `discoverPoolKey` below does the scan when a token is not listed.
 */
export const V4_POOLS: Record<string, PoolKey> = {
  [SAGE_V2_TOKEN_ADDRESS.toLowerCase()]: {
    currency0: TRADE_WETH_ADDRESS,
    currency1: SAGE_V2_TOKEN_ADDRESS,
    fee: 8388608, // 0x800000 — DYNAMIC_FEE_FLAG, the hook sets the real fee
    tickSpacing: 200,
    hooks: '0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544', // DopplerHookInitializer
  },
};

/** keccak256 of the abi-encoded PoolKey — v4's pool identifier. */
export function poolIdOf(key: PoolKey): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]
    )
  );
}

export function poolKeyFor(tokenAddress: string): PoolKey | null {
  return V4_POOLS[tokenAddress.toLowerCase()] || null;
}

/** True when the token is currency1, i.e. buying it means zeroForOne. */
function tokenIsCurrency1(key: PoolKey, tokenAddress: string): boolean {
  return key.currency1.toLowerCase() === tokenAddress.toLowerCase();
}

/**
 * Quote a buy. Returns tokens out for `ethAmount` in.
 *
 * Goes through the quoter rather than any local maths: with a dynamic-fee hook
 * there is no fee constant to reproduce, and inventing one would produce a
 * slippage floor that is confident and wrong.
 */
export async function quoteV4Buy(
  tokenAddress: string,
  ethAmount: ethers.BigNumber,
  provider: ethers.providers.Provider
): Promise<ethers.BigNumber> {
  const key = poolKeyFor(tokenAddress);
  if (!key) throw new Error('no v4 pool known for that token');
  const quoter = new ethers.Contract(V4_QUOTER, QUOTER_ABI, provider);
  const res = await quoter.callStatic.quoteExactInputSingle({
    poolKey: key,
    // buying the token means swapping the OTHER currency in
    zeroForOne: tokenIsCurrency1(key, tokenAddress),
    exactAmount: ethAmount,
    hookData: '0x',
  });
  return res.amountOut;
}

/** Quote a sell. Returns wei out for `tokenAmount` in. */
export async function quoteV4Sell(
  tokenAddress: string,
  tokenAmount: ethers.BigNumber,
  provider: ethers.providers.Provider
): Promise<ethers.BigNumber> {
  const key = poolKeyFor(tokenAddress);
  if (!key) throw new Error('no v4 pool known for that token');
  const quoter = new ethers.Contract(V4_QUOTER, QUOTER_ABI, provider);
  const res = await quoter.callStatic.quoteExactInputSingle({
    poolKey: key,
    zeroForOne: !tokenIsCurrency1(key, tokenAddress),
    exactAmount: tokenAmount,
    hookData: '0x',
  });
  return res.amountOut;
}

/** Live pool state — the fee the hook is currently charging, and depth. */
export async function v4PoolState(
  tokenAddress: string,
  provider: ethers.providers.Provider
): Promise<{ lpFeeBps: number; liquidity: ethers.BigNumber; tick: number } | null> {
  const key = poolKeyFor(tokenAddress);
  if (!key) return null;
  const view = new ethers.Contract(V4_STATE_VIEW, STATE_VIEW_ABI, provider);
  const id = poolIdOf(key);
  const [slot0, liquidity] = await Promise.all([view.getSlot0(id), view.getLiquidity(id)]);
  return {
    // v4 fees are hundredths of a bip; /100 gives bps
    lpFeeBps: Number(slot0.lpFee) / 100,
    liquidity,
    tick: Number(slot0.tick),
  };
}

/**
 * Build the UniversalRouter calldata for an ETH -> token v4 buy.
 *
 * Separated from sending so it can be simulated with callStatic before a
 * signature is requested. The pool is WETH-quoted, not native-ETH-quoted, so
 * the ETH is wrapped by the router first (WRAP_ETH) and the swap settles from
 * the router's own WETH balance.
 */
export function encodeV4Buy(
  key: PoolKey,
  zeroForOne: boolean,
  amountIn: ethers.BigNumber,
  minOut: ethers.BigNumber
): { commands: string; inputs: string[] } {
  const abi = ethers.utils.defaultAbiCoder;
  const currencyIn = zeroForOne ? key.currency0 : key.currency1;
  const currencyOut = zeroForOne ? key.currency1 : key.currency0;

  const actions = ethers.utils.solidityPack(
    ['uint8', 'uint8', 'uint8'],
    [ACT_SWAP_EXACT_IN_SINGLE, ACT_SETTLE_ALL, ACT_TAKE_ALL]
  );
  const swapParams = abi.encode(
    [
      '((address,address,uint24,int24,address),bool,uint128,uint128,bytes)',
    ],
    [
      [
        [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
        zeroForOne,
        amountIn,
        minOut,
        '0x',
      ],
    ]
  );
  const settle = abi.encode(['address', 'uint256'], [currencyIn, amountIn]);
  const take = abi.encode(['address', 'uint256'], [currencyOut, minOut]);

  return {
    commands: ethers.utils.solidityPack(['uint8', 'uint8'], [CMD_WRAP_ETH, CMD_V4_SWAP]),
    inputs: [
      abi.encode(['address', 'uint256'], [ADDRESS_THIS, amountIn]),
      abi.encode(['bytes', 'bytes[]'], [actions, [swapParams, settle, take]]),
    ],
  };
}

/**
 * Execute a v4 buy. Simulates first — a malformed action encoding otherwise
 * surfaces as an opaque revert AFTER the user has signed.
 */
export async function buyV4(
  tokenAddress: string,
  ethAmount: ethers.BigNumber,
  minOut: ethers.BigNumber,
  signer: Signer
): Promise<string> {
  const key = poolKeyFor(tokenAddress);
  if (!key) throw new Error('no v4 pool known for that token');
  const zeroForOne = tokenIsCurrency1(key, tokenAddress);
  const { commands, inputs } = encodeV4Buy(key, zeroForOne, ethAmount, minOut);

  const router = new ethers.Contract(V4_UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_ABI, signer);
  const deadline = Math.floor(Date.now() / 1000) + 900;

  await router.callStatic.execute(commands, inputs, deadline, { value: ethAmount });
  const tx = await router.execute(commands, inputs, deadline, { value: ethAmount });
  await tx.wait(1);
  return tx.hash;
}

export const V4_ADDRESSES = {
  poolManager: V4_POOL_MANAGER,
  quoter: V4_QUOTER,
  stateView: V4_STATE_VIEW,
  universalRouter: V4_UNIVERSAL_ROUTER,
};
