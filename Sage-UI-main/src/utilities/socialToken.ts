import { ethers, Signer } from 'ethers';
import factoryJson from '@/constants/abis/Social/SocialTokenFactory.sol/SocialTokenFactory.json';
import launcherJson from '@/constants/abis/Social/SocialNFTLauncher.sol/SocialNFTLauncher.json';
import minterJson from '@/constants/abis/Social/SocialCollectMinter.sol/SocialCollectMinter.json';
import ERC20StandardJson from '@/constants/abis/ERC-20/ERC20Standard.json';
import {
  parameters,
  SAGE_PRICE_TOKEN_ADDRESS,
  SAGE_PRICE_FACTORY_ADDRESS,
} from '@/constants/config';
import { toDecimalString } from '@/utilities/decimalString';

// Any token whose bonding-curve/graduation state lives on a factory OTHER
// than the current default — its state is in THAT contract's storage and
// can't be migrated when the default changes, so it must resolve there
// forever. SAGE is pinned to the ORIGINAL factory permanently. The 2026-07-19
// LP-to-treasury factory swap also caught a mainnet "test" token that had
// already graduated on the immediately-prior factory — same problem, smaller
// scale: swapping the default without pinning it would have pointed its
// pairOf() lookup at a factory that never processed its graduation, silently
// breaking its price/chart exactly like an unpinned SAGE would. Add an entry
// here every time SOCIAL_TOKEN_FACTORY_ADDRESS changes AND a token already
// graduated on the outgoing factory. Mirrors factoryForToken() in
// pages/api/social.page.ts — keep both in sync.
const LEGACY_FACTORY_BY_TOKEN: Record<string, string> = {
  [SAGE_PRICE_TOKEN_ADDRESS.toLowerCase()]: SAGE_PRICE_FACTORY_ADDRESS,
  '0x4b6fc1facc24d97010e07459788b6d985d6469d9':
    '0x6a22f6647b00022928bb103E66fA0a6659f7A64F', // "test" — graduated pre-2026-07-19 factory swap
};

export function factoryAddressForToken(tokenAddress?: string): string {
  const legacy = tokenAddress && LEGACY_FACTORY_BY_TOKEN[tokenAddress.toLowerCase()];
  return legacy || parameters.SOCIAL_TOKEN_FACTORY_ADDRESS;
}

// Pass the token being traded so SAGE routes to its original factory; omit it
// for token-agnostic calls like launch() (always the current factory).
export function factoryContract(
  signerOrProvider: Signer | ethers.providers.Provider,
  tokenAddress?: string
) {
  return new ethers.Contract(
    factoryAddressForToken(tokenAddress),
    factoryJson.abi,
    signerOrProvider
  );
}

/**
 * Launch a creator coin — creation is FREE, gas only (pump.fun-style).
 * enableAirdrop=false mints ZERO tokens to the creator: nothing to dump.
 * initialBuyEth > 0 executes a pump.fun-style DEV BUY in the same tx: it
 * seeds the curve/chart and makes the creator the first holder.
 *
 * Takes the RAW user-typed string, not a number — routing a small decimal
 * like "0.0000001" through Number()/String() flips it to JS scientific
 * notation ("1e-7"), which parseEther rejects with "invalid decimal value"
 * even though the original string was perfectly valid.
 */
export async function launchToken(
  name: string,
  symbol: string,
  enableAirdrop: boolean,
  signer: Signer,
  initialBuyEth = '0'
): Promise<{ token: string; txHash: string; devBuy: boolean }> {
  const factory = factoryContract(signer);
  const tx = await factory.launch(name, symbol, enableAirdrop, {
    value: Number(initialBuyEth) > 0 ? ethers.utils.parseEther(initialBuyEth) : 0,
  });
  const receipt = await tx.wait(1);
  const ev = receipt.events?.find((e: any) => e.event === 'TokenLaunched');
  const bought = receipt.events?.find((e: any) => e.event === 'Bought');
  return { token: ev?.args?.token, txHash: tx.hash, devBuy: !!bought };
}

/** Migrate a sold-out curve to its Uniswap pool — anyone can trigger. */
export async function graduateToken(tokenAddress: string, signer: Signer): Promise<string> {
  const factory = factoryContract(signer, tokenAddress);
  const tx = await factory.graduate(tokenAddress);
  await tx.wait(1);
  return tx.hash;
}

/**
 * Default slippage tolerance for a market buy, in basis points (2%).
 *
 * SECURITY: both buy paths below used to pass minTokensOut = 0, which is not
 * "no preference" — it is an instruction to accept ANY amount of tokens for
 * your ETH. A sandwich bot can front-run the trade, move the price, and leave
 * the buyer with dust; on a thin bonding curve that is a total loss of the
 * spend. Quoting first and demanding at least (quote − tolerance) makes the
 * trade revert instead of filling at an arbitrary price.
 */
const DEFAULT_SLIPPAGE_BPS = 200;

/** quote → minOut, or throw. Never silently degrade to an unprotected buy. */
function applySlippage(quoted: ethers.BigNumber, slippageBps: number): ethers.BigNumber {
  const bps = Math.max(0, Math.min(5000, Math.floor(slippageBps)));
  const minOut = quoted.mul(10000 - bps).div(10000);
  if (minOut.lte(0)) {
    throw new Error('quote returned zero — refusing to buy without price protection');
  }
  return minOut;
}

// ───────────── generic venue resolution (any token, any factory) ───────────
//
// A token is buyable at exactly one of two venues, and which one is a property
// of CHAIN STATE, not of configuration:
//
//   pre-graduation   → the bonding curve, on the factory that launched it
//   post-graduation  → the Uniswap pair, via SageSwapRouter
//
// Guessing wrong does not fail loudly. A graduated token still answers
// `quoteBuy` on its factory — with ZERO, because the curve is spent — so the
// curve path on a graduated token produces a zero quote rather than an error.
// That is exactly what mainnet SAGE does today, and it is why this resolves
// the venue from `curves().complete` and then insists on a non-zero quote.

export type Venue = 'curve' | 'pool' | 'dex' | 'v4';

export interface BuyVenue {
  venue: Venue;
  /** address actually called to execute the buy */
  target: string;
  /** tokens out at the current block, before slippage */
  quoted: ethers.BigNumber;
  graduated: boolean;
  /** false when no factory in the candidate list ever launched this token */
  launchedHere: boolean;
}

export interface VenueOptions {
  /** factories to search, newest first. Defaults to the configured one. */
  factories?: string[];
  router?: string;
  /** chain-wide Uniswap v2 router, for tokens SAGE did not launch */
  dexRouter?: string;
  weth?: string;
}

/** Minimal Uniswap v2 router surface — quote, buy, sell. */
const DEX_ROUTER_ABI = [
  'function getAmountsOut(uint256,address[]) view returns (uint256[])',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)',
];

/**
 * Work out where `tokenAddress` trades and what it currently quotes.
 *
 * Read-only: safe to call before showing the user an order. Throws with a
 * message meant to be read by a human, because every one of these failures
 * otherwise surfaces as ethers' opaque `call revert exception`.
 */
export async function resolveBuyVenue(
  tokenAddress: string,
  ethAmount: number,
  provider: ethers.providers.Provider,
  opts: VenueOptions = {}
): Promise<BuyVenue> {
  if (!ethers.utils.isAddress(tokenAddress)) {
    throw new Error(`${tokenAddress} is not a valid token address`);
  }
  const value = ethers.utils.parseEther(toDecimalString(ethAmount));

  // A wrong-chain address is the single most common failure, and the bare
  // revert it produces is unreadable. Name it before anything else.
  if ((await provider.getCode(tokenAddress)) === '0x') {
    const net = await provider.getNetwork();
    throw new Error(
      `no token contract at ${tokenAddress} on chain ${net.chainId} — check the address, or whether this token lives on another network`
    );
  }

  // Search the candidate factories for the one holding this token's curve.
  // A legacy pin wins outright: that IS the launching factory.
  const pinned = LEGACY_FACTORY_BY_TOKEN[tokenAddress.toLowerCase()];
  const candidates = pinned
    ? [pinned]
    : opts.factories?.length
    ? opts.factories
    : [parameters.SOCIAL_TOKEN_FACTORY_ADDRESS];

  let graduated = false;
  let launchedHere = false;
  let curveFactory = '';
  for (const address of candidates) {
    try {
      const curve = await new ethers.Contract(address, factoryJson.abi, provider).curves(
        tokenAddress
      );
      if (curve.creator && curve.creator !== ethers.constants.AddressZero) {
        launchedHere = true;
        graduated = !!curve.complete;
        curveFactory = address;
        break;
      }
    } catch {
      /* not a factory, or an ABI mismatch — try the next candidate */
    }
  }

  // Pre-graduation: quote off the curve. Its quoteBuy takes the POST-fee
  // amount, unlike the router's, so net the fee off first.
  if (launchedHere && !graduated) {
    const factory = new ethers.Contract(curveFactory, factoryJson.abi, provider);
    const feeBps = await factory.FEE_BPS();
    const quoted = await factory.quoteBuy(tokenAddress, value.sub(value.mul(feeBps).div(10000)));
    if (quoted.gt(0)) {
      return { venue: 'curve', target: curveFactory, quoted, graduated: false, launchedHere: true };
    }
    // A live curve quoting zero means it graduated between the read and now,
    // or the ABI is lying about the state. Fall through to the pool.
  }

  // Graduated, or launched somewhere we don't track, or not one of ours at
  // all — the router prices any pair on the chain, so let it answer.
  const router = new ethers.Contract(
    opts.router || parameters.SAGE_SWAP_ROUTER_ADDRESS,
    routerJson.abi,
    provider
  );
  let quoted = ethers.BigNumber.from(0);
  try {
    quoted = await router.quoteBuy(tokenAddress, value);
  } catch {
    /* no pair — reported as "no market" below, not as a raw revert */
  }
  if (quoted.gt(0)) {
    return { venue: 'pool', target: router.address, quoted, graduated: true, launchedHere };
  }

  // Uniswap v4 next. Pools there are singleton state in a PoolManager with no
  // pair contract, so every v2 lookup above reports "no market" for a token
  // that may hold millions in liquidity — which is exactly how the second SAGE
  // read as unlisted. The fee is hook-set and dynamic, so the quote must come
  // from the on-chain quoter rather than any local maths.
  try {
    const { poolKeyFor, quoteV4Buy } = await import('@/utilities/uniswapV4');
    if (poolKeyFor(tokenAddress)) {
      const out = await quoteV4Buy(tokenAddress, value, provider);
      if (out.gt(0)) {
        const { V4_UNIVERSAL_ROUTER } = await import('@/constants/config');
        return { venue: 'v4', target: V4_UNIVERSAL_ROUTER, quoted: out, graduated: true, launchedHere };
      }
    }
  } catch {
    /* not on v4, or the quoter reverted — fall through to the v2 sweep */
  }

  // Not one of ours: SageSwapRouter only resolves pairs through its own curve
  // factory, so it answers "not graduated" for every token minted elsewhere on
  // the chain. Fall back to the chain-wide v2 router, which prices any WETH
  // pair — this is what makes a token like Cash Cat reachable at all.
  if (opts.dexRouter && opts.weth) {
    try {
      const dex = new ethers.Contract(opts.dexRouter, DEX_ROUTER_ABI, provider);
      const amounts = await dex.getAmountsOut(value, [opts.weth, tokenAddress]);
      const out = amounts[amounts.length - 1];
      if (out.gt(0)) {
        return { venue: 'dex', target: opts.dexRouter, quoted: out, graduated: false, launchedHere };
      }
    } catch {
      /* no pair on the chain-wide DEX either — reported below */
    }
  }

  throw new Error(
    launchedHere
      ? 'this token has no liquidity to buy from right now'
      : `no market for ${tokenAddress} on this chain — no bonding curve, no SAGE pool, and no DEX pair`
  );
}

/**
 * Buy ANY token with ETH, routing to whichever venue actually holds its
 * liquidity. Prefer this over buyToken/buyOnPool when the token is not known
 * ahead of time — those two commit to a venue at the call site.
 */
export async function buyAnyToken(
  tokenAddress: string,
  ethAmount: number,
  signer: Signer,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
  opts: VenueOptions = {}
): Promise<{ hash: string; venue: Venue; quoted: ethers.BigNumber }> {
  const provider = signer.provider;
  if (!provider) throw new Error('wallet has no provider — reconnect and try again');

  const resolved = await resolveBuyVenue(tokenAddress, ethAmount, provider, opts);
  const value = ethers.utils.parseEther(toDecimalString(ethAmount));
  const minOut = applySlippage(resolved.quoted, slippageBps);

  if (resolved.venue === 'v4') {
    const { buyV4 } = await import('@/utilities/uniswapV4');
    const hash = await buyV4(tokenAddress, value, minOut, signer);
    return { hash, venue: resolved.venue, quoted: resolved.quoted };
  }

  if (resolved.venue === 'dex') {
    // SupportingFeeOnTransfer: tokens SAGE did not launch may tax transfers,
    // and the plain variant reverts on those rather than filling.
    const dex = new ethers.Contract(resolved.target, DEX_ROUTER_ABI, signer);
    const to = await signer.getAddress();
    const deadline = Math.floor(Date.now() / 1000) + 900;
    const tx = await dex.swapExactETHForTokensSupportingFeeOnTransferTokens(
      minOut,
      [opts.weth, tokenAddress],
      to,
      deadline,
      { value }
    );
    await tx.wait(1);
    return { hash: tx.hash, venue: resolved.venue, quoted: resolved.quoted };
  }

  const abi = resolved.venue === 'curve' ? factoryJson.abi : routerJson.abi;
  const contract = new ethers.Contract(resolved.target, abi, signer);
  const tx = await contract.buy(tokenAddress, minOut, { value });
  await tx.wait(1);
  return { hash: tx.hash, venue: resolved.venue, quoted: resolved.quoted };
}

// ───────────── sell-side quoting (neither venue exposes quoteSell) ─────────
//
// `sell(token, amount, minEthOut)` exists on both venues but there is no
// on-chain sell quote, which is why every sell in this file historically
// passed minEthOut = 0 — an unprotected market order that a sandwich can take
// almost all of. The proceeds are computable: both venues price by constant
// product, and both DO expose a buy quote. So rather than hardcode a fee that
// has already changed once between router versions, derive it — find the fee
// that reproduces the venue's own quoteBuy exactly, then apply it to the sell.

const UNISWAP_PAIR_ABI = [
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function token0() view returns (address)',
];
const ROUTER_META_ABI = [
  'function weth() view returns (address)',
  'function curveFactory() view returns (address)',
];

/** Uniswap v2 constant-product output, including the pair's own 0.3%. */
function ammOut(
  amountIn: ethers.BigNumber,
  reserveIn: ethers.BigNumber,
  reserveOut: ethers.BigNumber
): ethers.BigNumber {
  if (amountIn.lte(0) || reserveIn.lte(0) || reserveOut.lte(0)) {
    return ethers.BigNumber.from(0);
  }
  const inWithFee = amountIn.mul(997);
  return inWithFee.mul(reserveOut).div(reserveIn.mul(1000).add(inWithFee));
}

/**
 * The venue's fee in bps, found by reproducing its own buy quote.
 *
 * Exact-match search rather than a constant: the mainnet router charges 123bps
 * and predates the `feeBpsFor()` getter the current ABI declares, so asking it
 * directly reverts. Returns null when nothing matches, so callers can refuse
 * to quote instead of inventing a number.
 */
async function impliedFeeBps(
  quote: (ethIn: ethers.BigNumber) => Promise<ethers.BigNumber>,
  reserveEth: ethers.BigNumber,
  reserveTok: ethers.BigNumber
): Promise<number | null> {
  const probe = reserveEth.div(1000); // ~0.1% of the pool: real, but tiny impact
  if (probe.lte(0)) return null;
  let actual: ethers.BigNumber;
  try {
    actual = await quote(probe);
  } catch {
    return null;
  }
  if (actual.lte(0)) return null;
  for (let bps = 0; bps <= 500; bps++) {
    const net = probe.sub(probe.mul(bps).div(10000));
    if (ammOut(net, reserveEth, reserveTok).eq(actual)) return bps;
  }
  return null;
}

export interface SellVenue {
  venue: Venue;
  /** address to call sell() on */
  target: string;
  /** ETH out at the current block, before slippage */
  quoted: ethers.BigNumber;
  feeBps: number;
}

/**
 * Work out where `tokenAddress` sells and what the proceeds are worth now.
 * `tokenAmount` is in whole tokens, matching sellToken/sellOnPool.
 */
export async function resolveSellVenue(
  tokenAddress: string,
  tokenAmount: number,
  provider: ethers.providers.Provider,
  opts: VenueOptions = {}
): Promise<SellVenue> {
  if (!ethers.utils.isAddress(tokenAddress)) {
    throw new Error(`${tokenAddress} is not a valid token address`);
  }
  if ((await provider.getCode(tokenAddress)) === '0x') {
    const net = await provider.getNetwork();
    throw new Error(
      `no token contract at ${tokenAddress} on chain ${net.chainId} — wrong network for this token`
    );
  }
  const amountIn = ethers.utils.parseEther(toDecimalString(tokenAmount));
  if (amountIn.lte(0)) throw new Error('sell amount must be greater than zero');

  // Which factory holds this token's curve, and has it graduated?
  const pinned = LEGACY_FACTORY_BY_TOKEN[tokenAddress.toLowerCase()];
  const candidates = pinned
    ? [pinned]
    : opts.factories?.length
    ? opts.factories
    : [parameters.SOCIAL_TOKEN_FACTORY_ADDRESS];

  let curveFactory = '';
  let graduated = false;
  for (const address of candidates) {
    try {
      const curve = await new ethers.Contract(address, factoryJson.abi, provider).curves(
        tokenAddress
      );
      if (curve.creator && curve.creator !== ethers.constants.AddressZero) {
        curveFactory = address;
        graduated = !!curve.complete;
        // Pre-graduation the curve's own virtual reserves ARE the market.
        if (!graduated) {
          const factory = new ethers.Contract(address, factoryJson.abi, provider);
          const feeBps: number = Number(await factory.FEE_BPS());
          const gross = ammOut(amountIn, curve.virtualTokenReserves, curve.virtualEthReserves);
          const quoted = gross.sub(gross.mul(feeBps).div(10000));
          if (quoted.lte(0)) throw new Error('this curve cannot buy back that amount right now');
          return { venue: 'curve', target: address, quoted, feeBps };
        }
      }
    } catch (e: any) {
      if (e?.message?.includes('curve cannot buy back')) throw e;
      /* not a factory for this token — keep looking */
    }
  }

  // Graduated (or not ours): price against the real pair behind the router.
  const routerAddress = opts.router || parameters.SAGE_SWAP_ROUTER_ADDRESS;
  const router = new ethers.Contract(routerAddress, routerJson.abi, provider);
  const meta = new ethers.Contract(routerAddress, ROUTER_META_ABI, provider);

  let pair = '';
  let weth = '';
  try {
    weth = await meta.weth();
    const factoryForPair = curveFactory || (await meta.curveFactory());
    pair = await new ethers.Contract(factoryForPair, factoryJson.abi, provider).pairOf(
      tokenAddress
    );
  } catch {
    /* handled by the pair check below */
  }
  if (!pair || pair === ethers.constants.AddressZero) {
    // v4 first, same reasoning as the buy side.
    try {
      const { poolKeyFor, quoteV4Sell } = await import('@/utilities/uniswapV4');
      if (poolKeyFor(tokenAddress)) {
        const out = await quoteV4Sell(tokenAddress, amountIn, provider);
        if (out.gt(0)) {
          const { V4_UNIVERSAL_ROUTER } = await import('@/constants/config');
          return { venue: 'v4', target: V4_UNIVERSAL_ROUTER, quoted: out, feeBps: 0 };
        }
      }
    } catch {
      /* fall through */
    }

    // Same fallback as the buy side: not a SAGE launch, so price it against
    // the chain-wide DEX instead of refusing.
    if (opts.dexRouter && opts.weth) {
      try {
        const dex = new ethers.Contract(opts.dexRouter, DEX_ROUTER_ABI, provider);
        const amounts = await dex.getAmountsOut(amountIn, [tokenAddress, opts.weth]);
        const out = amounts[amounts.length - 1];
        if (out.gt(0)) return { venue: 'dex', target: opts.dexRouter, quoted: out, feeBps: 0 };
      } catch {
        /* reported below */
      }
    }
    throw new Error(`no pool to sell ${tokenAddress} into on this chain`);
  }

  const pairContract = new ethers.Contract(pair, UNISWAP_PAIR_ABI, provider);
  const [reserves, token0] = await Promise.all([pairContract.getReserves(), pairContract.token0()]);
  const wethIsToken0 = token0.toLowerCase() === weth.toLowerCase();
  const reserveEth = wethIsToken0 ? reserves[0] : reserves[1];
  const reserveTok = wethIsToken0 ? reserves[1] : reserves[0];

  const feeBps = await impliedFeeBps(
    (ethIn) => router.quoteBuy(tokenAddress, ethIn),
    reserveEth,
    reserveTok
  );
  if (feeBps === null) {
    throw new Error('could not determine this pool’s fee, so the sale cannot be priced safely');
  }

  const gross = ammOut(amountIn, reserveTok, reserveEth);
  const quoted = gross.sub(gross.mul(feeBps).div(10000));
  if (quoted.lte(0)) throw new Error('this pool has too little liquidity to sell into');
  return { venue: 'pool', target: routerAddress, quoted, feeBps };
}

/**
 * How many whole tokens to sell to raise roughly `targetEth`.
 *
 * Sizing off the spot price alone is wrong for anything but a dust trade,
 * because selling moves the price against you. So this quotes what the naive
 * size would actually raise and rescales once by the shortfall — one extra
 * read, and it converges tightly for any size the pool can absorb.
 */
export async function sizeSellForEth(
  tokenAddress: string,
  targetEth: number,
  provider: ethers.providers.Provider,
  opts: VenueOptions = {}
): Promise<number> {
  const target = ethers.utils.parseEther(toDecimalString(targetEth));
  if (target.lte(0)) throw new Error('amount must be greater than zero');

  // wei per whole token: the router knows it post-graduation, the curve pre-.
  let spotWei: ethers.BigNumber = ethers.BigNumber.from(0);
  try {
    const router = new ethers.Contract(
      opts.router || parameters.SAGE_SWAP_ROUTER_ADDRESS,
      ['function poolPriceWei(address) view returns (uint256)'],
      provider
    );
    spotWei = await router.poolPriceWei(tokenAddress);
  } catch {
    /* not pooled — fall through to the curve */
  }
  if (spotWei.lte(0)) {
    const factories = opts.factories?.length
      ? opts.factories
      : [parameters.SOCIAL_TOKEN_FACTORY_ADDRESS];
    const pinned = LEGACY_FACTORY_BY_TOKEN[tokenAddress.toLowerCase()];
    for (const address of pinned ? [pinned] : factories) {
      try {
        const f = new ethers.Contract(
          address,
          ['function spotPriceWei(address) view returns (uint256)'],
          provider
        );
        const wei = await f.spotPriceWei(tokenAddress);
        if (wei.gt(0)) {
          spotWei = wei;
          break;
        }
      } catch {
        /* try the next factory */
      }
    }
  }
  if (spotWei.lte(0)) throw new Error('no price available for that token');

  const naive = Number(ethers.utils.formatEther(target.mul(ethers.constants.WeiPerEther).div(spotWei)));
  if (!(naive > 0)) throw new Error('that amount is too small to sell');

  // Correct for the price impact the naive size ignores.
  const { quoted } = await resolveSellVenue(tokenAddress, naive, provider, opts);
  const raised = Number(ethers.utils.formatEther(quoted));
  if (raised <= 0) throw new Error('that token has no liquidity to sell into');
  const corrected = naive * (targetEth / raised);
  return Number(corrected.toFixed(6));
}

/**
 * Sell ANY token for ETH at whichever venue holds its liquidity, WITH price
 * protection. Approves the venue first if needed.
 */
export async function sellAnyToken(
  tokenAddress: string,
  tokenAmount: number,
  signer: Signer,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
  opts: VenueOptions = {}
): Promise<{ hash: string; venue: Venue; quoted: ethers.BigNumber }> {
  const provider = signer.provider;
  if (!provider) throw new Error('wallet has no provider — reconnect and try again');

  const resolved = await resolveSellVenue(tokenAddress, tokenAmount, provider, opts);
  const amount = ethers.utils.parseEther(toDecimalString(tokenAmount));
  const minEthOut = applySlippage(resolved.quoted, slippageBps);

  const owner = await signer.getAddress();
  const token = new ethers.Contract(tokenAddress, ERC20StandardJson.abi, signer);
  const balance: ethers.BigNumber = await token.balanceOf(owner);
  if (balance.lt(amount)) {
    throw new Error(
      `you hold ${Number(ethers.utils.formatEther(balance)).toLocaleString()} of this token, less than the ${tokenAmount.toLocaleString()} being sold`
    );
  }

  const allowance: ethers.BigNumber = await token.allowance(owner, resolved.target);
  if (allowance.lt(amount)) {
    const approve = await token.approve(resolved.target, amount);
    await approve.wait(1);
  }

  if (resolved.venue === 'v4') {
    // Handles the Permit2 chain itself, so the wallet may prompt up to three
    // times on a first sale (ERC20 approve, Permit2 approve, then the swap).
    const { sellV4 } = await import('@/utilities/uniswapV4');
    const { hash } = await sellV4(tokenAddress, amount, minEthOut, signer);
    return { hash, venue: resolved.venue, quoted: resolved.quoted };
  }

  if (resolved.venue === 'dex') {
    const dex = new ethers.Contract(resolved.target, DEX_ROUTER_ABI, signer);
    const deadline = Math.floor(Date.now() / 1000) + 900;
    const tx = await dex.swapExactTokensForETHSupportingFeeOnTransferTokens(
      amount,
      minEthOut,
      [tokenAddress, opts.weth],
      owner,
      deadline
    );
    await tx.wait(1);
    return { hash: tx.hash, venue: resolved.venue, quoted: resolved.quoted };
  }

  const abi = resolved.venue === 'curve' ? factoryJson.abi : routerJson.abi;
  const contract = new ethers.Contract(resolved.target, abi, signer);
  const tx = await contract.sell(tokenAddress, amount, minEthOut);
  await tx.wait(1);
  return { hash: tx.hash, venue: resolved.venue, quoted: resolved.quoted };
}

/** Buy a creator coin off the bonding curve with ETH (1% fee to the treasury). */
export async function buyToken(
  tokenAddress: string,
  ethAmount: number,
  signer: Signer,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS
): Promise<string> {
  const factory = factoryContract(signer, tokenAddress);
  const value = ethers.utils.parseEther(toDecimalString(ethAmount));
  // The curve's quoteBuy expects the POST-fee amount, unlike the router's
  // (which takes the gross). Read the fee off the contract rather than
  // hardcoding it, so a fee-tier change can't silently skew the quote.
  const feeBps = await factory.FEE_BPS();
  const ethInAfterFee = value.sub(value.mul(feeBps).div(10000));
  const quoted = await factory.quoteBuy(tokenAddress, ethInAfterFee);
  const tx = await factory.buy(tokenAddress, applySlippage(quoted, slippageBps), { value });
  await tx.wait(1);
  return tx.hash;
}

/** Sell tokens back to the curve. Approves the factory, then sells `amount` (whole tokens). */
export async function sellToken(
  tokenAddress: string,
  amount: number,
  signer: Signer,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS
): Promise<string> {
  // Delegates to sellAnyToken, which prices the sale and bounds it. This used
  // to pass minEthOut = 0 — an unprotected market order — because no venue
  // exposes a quoteSell and the curve math had not been reimplemented. It has
  // been now (resolveSellVenue), so the exemption no longer holds.
  //
  // Routing through the resolver also fixes the venue: the caller decided
  // curve-vs-pool from its own read, and a token that graduated since would
  // sell into a spent curve.
  const { hash } = await sellAnyToken(tokenAddress, amount, signer, slippageBps);
  return hash;
}

/** The signed-in wallet's balance of a creator coin (whole tokens). */
export async function tokenBalanceOf(
  tokenAddress: string,
  owner: string,
  provider: ethers.providers.Provider
): Promise<number> {
  const token = new ethers.Contract(tokenAddress, ERC20StandardJson.abi, provider);
  return Number(ethers.utils.formatEther(await token.balanceOf(owner)));
}

/** Airdrop from the creator's own balance to a list of followers. */
export async function airdropToken(
  tokenAddress: string,
  recipients: string[],
  amountEach: number,
  signer: Signer
): Promise<string> {
  const factory = factoryContract(signer, tokenAddress);
  const token = new ethers.Contract(tokenAddress, ERC20StandardJson.abi, signer);
  const total = ethers.utils.parseEther(toDecimalString(amountEach)).mul(recipients.length);
  const approve = await token.approve(factoryAddressForToken(tokenAddress), total);
  await approve.wait(1);
  const tx = await factory.airdrop(
    tokenAddress,
    recipients,
    ethers.utils.parseEther(toDecimalString(amountEach))
  );
  await tx.wait(1);
  return tx.hash;
}

/** Spot price in ETH per 1M tokens — the readable denomination for micro-caps. */
export async function tokenSpotPriceEthPerMillion(
  tokenAddress: string,
  provider: ethers.providers.Provider
): Promise<number> {
  const factory = factoryContract(provider, tokenAddress);
  const wei = await factory.spotPriceWei(tokenAddress); // wei per whole token
  return Number(ethers.utils.formatEther(wei.mul(1_000_000)));
}

/**
 * Redeem a server-signed collect voucher — THE COLLECTOR pays this mint's gas.
 * The server already settled payment and returned {minter, postId, uri, signature}.
 */
export async function redeemCollectVoucher(
  minter: string,
  postId: number,
  uri: string,
  signature: string,
  signer: Signer
): Promise<string> {
  const c = new ethers.Contract(minter, minterJson.abi, signer);
  const tx = await c.mintWithVoucher(postId, uri, signature);
  await tx.wait(1);
  return tx.hash;
}


// ───────────── NFT edition launcher (pump.fun-shaped mint fees) ─────────────

/**
 * Refuse to transact with an address that holds no code.
 *
 * The EVM treats a call to an empty address as a successful no-op, so a
 * wrong-chain contract address produces a MINED transaction that did nothing —
 * gas spent, no event, and an error message about a missing receipt event that
 * points at the wrong problem entirely. Checking first turns that into a
 * sentence naming the real fault.
 */
export async function assertContractExists(
  address: string,
  provider: ethers.providers.Provider,
  label: string
): Promise<void> {
  if ((await provider.getCode(address)) === '0x') {
    const net = await provider.getNetwork();
    throw new Error(
      `${label} is not deployed at ${address} on chain ${net.chainId} — wrong network for this action`
    );
  }
}

export function launcherContract(
  signerOrProvider: Signer | ethers.providers.Provider,
  launcherAddress?: string
) {
  return new ethers.Contract(
    launcherAddress || parameters.SOCIAL_NFT_LAUNCHER_ADDRESS,
    launcherJson.abi,
    signerOrProvider
  );
}

/** Create an edition — FREE (gas only). Returns {edition, txHash}. */
export async function createEdition(
  name: string,
  symbol: string,
  uri: string,
  maxSupply: number,
  priceEth: number,
  signer: Signer,
  launcherAddress?: string
): Promise<{ edition: string; txHash: string }> {
  const target = launcherAddress || parameters.SOCIAL_NFT_LAUNCHER_ADDRESS;
  // Preflight: a codeless target mines a no-op instead of reverting.
  if (signer.provider) await assertContractExists(target, signer.provider, 'the NFT launcher');
  const launcher = launcherContract(signer, target);
  const tx = await launcher.createEdition(
    name,
    symbol,
    uri,
    maxSupply,
    ethers.utils.parseEther(toDecimalString(priceEth))
  );
  const receipt = await tx.wait(1);
  const ev = receipt.events?.find((e: any) => e.event === 'EditionCreated');
  // Without this, a missing/unparsed event silently sent editionAddress:
  // undefined through to RecordEditionLaunch, which 400'd with a generic
  // "editionAddress, name, symbol, imageUrl, launchTxHash required" — the
  // tx had actually mined fine, so that error was pointing at the wrong step.
  if (!ev?.args?.edition) {
    throw new Error(
      `Edition deployed (tx ${tx.hash}) but its address couldn't be read from the receipt — try refreshing and checking your editions list before relaunching.`
    );
  }
  return { edition: ev.args.edition, txHash: tx.hash };
}

/**
 * Create a generative COLLECTION — each token gets unique metadata at
 * baseUri/{id}.json (built from the artist's ZIP by /api/social-collection).
 */
export async function createCollection(
  name: string,
  symbol: string,
  baseUri: string,
  maxSupply: number,
  priceEth: number,
  signer: Signer,
  launcherAddress?: string
): Promise<{ edition: string; txHash: string }> {
  const target = launcherAddress || parameters.SOCIAL_NFT_LAUNCHER_ADDRESS;
  // Preflight: a codeless target mines a no-op instead of reverting.
  if (signer.provider) await assertContractExists(target, signer.provider, 'the NFT launcher');
  const launcher = launcherContract(signer, target);
  const tx = await launcher.createCollection(
    name,
    symbol,
    baseUri,
    maxSupply,
    ethers.utils.parseEther(toDecimalString(priceEth))
  );
  const receipt = await tx.wait(1);
  const ev = receipt.events?.find((e: any) => e.event === 'EditionCreated');
  if (!ev?.args?.edition) {
    throw new Error(
      `Collection deployed (tx ${tx.hash}) but its address couldn't be read from the receipt — try refreshing and checking your editions list before relaunching.`
    );
  }
  return { edition: ev.args.edition, txHash: tx.hash };
}

/** Mint one from an edition — the minter pays price + gas; 1% to the platform. */
export async function mintEdition(
  editionAddress: string,
  priceEth: number,
  signer: Signer
): Promise<string> {
  const launcher = launcherContract(signer);
  const tx = await launcher.mint(editionAddress, {
    value: ethers.utils.parseEther(toDecimalString(priceEth)),
  });
  await tx.wait(1);
  return tx.hash;
}

export async function editionMinted(
  editionAddress: string,
  provider: ethers.providers.Provider
): Promise<number> {
  const launcher = launcherContract(provider);
  return (await launcher.mintedOf(editionAddress)).toNumber();
}

// ───────────── post-graduation trading via SageSwapRouter ─────────────

import routerJson from '@/constants/abis/Social/SageSwapRouter.sol/SageSwapRouter.json';

export function swapRouterContract(signerOrProvider: Signer | ethers.providers.Provider) {
  return new ethers.Contract(parameters.SAGE_SWAP_ROUTER_ADDRESS, routerJson.abi, signerOrProvider);
}

/** Buy a GRADUATED token on its Uniswap pool (0.25% router fee: 0.05% creator). */
export async function buyOnPool(
  tokenAddress: string,
  ethAmount: number,
  signer: Signer,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS
): Promise<string> {
  const router = swapRouterContract(signer);
  const value = ethers.utils.parseEther(toDecimalString(ethAmount));
  // The router's quoteBuy takes the GROSS amount and nets the fee internally.
  const quoted = await router.quoteBuy(tokenAddress, value);
  const tx = await router.buy(tokenAddress, applySlippage(quoted, slippageBps), { value });
  await tx.wait(1);
  return tx.hash;
}

/** Sell a GRADUATED token on its pool — approves the router if needed. */
export async function sellOnPool(
  tokenAddress: string,
  tokenAmount: number,
  signer: Signer,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS
): Promise<string> {
  // See sellToken: same unprotected-sell fix. This path additionally used to
  // approve MaxUint256 to the router, which leaves a standing claim on the
  // whole balance long after the sale; sellAnyToken approves the exact amount.
  const { hash } = await sellAnyToken(tokenAddress, tokenAmount, signer, slippageBps);
  return hash;
}

/** Creator revenue accrued on the router for this token (claimable + lifetime). */
export async function creatorFeesOf(
  tokenAddress: string,
  provider: ethers.providers.Provider
): Promise<{ claimable: number; lifetime: number }> {
  const router = swapRouterContract(provider);
  const [claimable, lifetime] = await Promise.all([
    router.creatorFees(tokenAddress),
    router.creatorFeesLifetime(tokenAddress),
  ]);
  return {
    claimable: Number(ethers.utils.formatEther(claimable)),
    lifetime: Number(ethers.utils.formatEther(lifetime)),
  };
}

export async function claimCreatorFees(tokenAddress: string, signer: Signer): Promise<string> {
  const router = swapRouterContract(signer);
  const tx = await router.claimCreatorFees(tokenAddress);
  await tx.wait(1);
  return tx.hash;
}
