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

/** Buy a creator coin off the bonding curve with ETH (1% fee to the treasury). */
export async function buyToken(
  tokenAddress: string,
  ethAmount: number,
  signer: Signer
): Promise<string> {
  const factory = factoryContract(signer, tokenAddress);
  const tx = await factory.buy(tokenAddress, 0, {
    value: ethers.utils.parseEther(toDecimalString(ethAmount)),
  });
  await tx.wait(1);
  return tx.hash;
}

/** Sell tokens back to the curve. Approves the factory, then sells `amount` (whole tokens). */
export async function sellToken(
  tokenAddress: string,
  amount: number,
  signer: Signer
): Promise<string> {
  const factory = factoryContract(signer, tokenAddress);
  const token = new ethers.Contract(tokenAddress, ERC20StandardJson.abi, signer);
  const wei = ethers.utils.parseEther(toDecimalString(amount));
  const approve = await token.approve(factoryAddressForToken(tokenAddress), wei);
  await approve.wait(1);
  const tx = await factory.sell(tokenAddress, wei, 0);
  await tx.wait(1);
  return tx.hash;
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

export function launcherContract(signerOrProvider: Signer | ethers.providers.Provider) {
  return new ethers.Contract(
    parameters.SOCIAL_NFT_LAUNCHER_ADDRESS,
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
  signer: Signer
): Promise<{ edition: string; txHash: string }> {
  const launcher = launcherContract(signer);
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
  signer: Signer
): Promise<{ edition: string; txHash: string }> {
  const launcher = launcherContract(signer);
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
export async function buyOnPool(tokenAddress: string, ethAmount: number, signer: Signer): Promise<string> {
  const router = swapRouterContract(signer);
  const tx = await router.buy(tokenAddress, 0, { value: ethers.utils.parseEther(toDecimalString(ethAmount)) });
  await tx.wait(1);
  return tx.hash;
}

/** Sell a GRADUATED token on its pool — approves the router if needed. */
export async function sellOnPool(tokenAddress: string, tokenAmount: number, signer: Signer): Promise<string> {
  const router = swapRouterContract(signer);
  const owner = await signer.getAddress();
  const token = new ethers.Contract(
    tokenAddress,
    ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'],
    signer
  );
  const amount = ethers.utils.parseEther(toDecimalString(tokenAmount));
  const allowance = await token.allowance(owner, router.address);
  if (allowance.lt(amount)) {
    const a = await token.approve(router.address, ethers.constants.MaxUint256);
    await a.wait(1);
  }
  const tx = await router.sell(tokenAddress, amount, 0);
  await tx.wait(1);
  return tx.hash;
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
