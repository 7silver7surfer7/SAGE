import { ethers, Signer } from 'ethers';
import factoryJson from '@/constants/abis/Social/SocialTokenFactory.sol/SocialTokenFactory.json';
import launcherJson from '@/constants/abis/Social/SocialNFTLauncher.sol/SocialNFTLauncher.json';
import minterJson from '@/constants/abis/Social/SocialCollectMinter.sol/SocialCollectMinter.json';
import ERC20StandardJson from '@/constants/abis/ERC-20/ERC20Standard.json';
import { parameters } from '@/constants/config';

export function factoryContract(signerOrProvider: Signer | ethers.providers.Provider) {
  return new ethers.Contract(
    parameters.SOCIAL_TOKEN_FACTORY_ADDRESS,
    factoryJson.abi,
    signerOrProvider
  );
}

/**
 * Launch a creator coin — creation is FREE, gas only (pump.fun-style).
 * enableAirdrop=false mints ZERO tokens to the creator: nothing to dump.
 * initialBuyEth > 0 executes a pump.fun-style DEV BUY in the same tx: it
 * seeds the curve/chart and makes the creator the first holder.
 */
export async function launchToken(
  name: string,
  symbol: string,
  enableAirdrop: boolean,
  signer: Signer,
  initialBuyEth = 0
): Promise<{ token: string; txHash: string; devBuy: boolean }> {
  const factory = factoryContract(signer);
  const tx = await factory.launch(name, symbol, enableAirdrop, {
    value: initialBuyEth > 0 ? ethers.utils.parseEther(String(initialBuyEth)) : 0,
  });
  const receipt = await tx.wait(1);
  const ev = receipt.events?.find((e: any) => e.event === 'TokenLaunched');
  const bought = receipt.events?.find((e: any) => e.event === 'Bought');
  return { token: ev?.args?.token, txHash: tx.hash, devBuy: !!bought };
}

/** Migrate a sold-out curve to its Uniswap pool — anyone can trigger. */
export async function graduateToken(tokenAddress: string, signer: Signer): Promise<string> {
  const factory = factoryContract(signer);
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
  const factory = factoryContract(signer);
  const tx = await factory.buy(tokenAddress, 0, {
    value: ethers.utils.parseEther(String(ethAmount)),
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
  const factory = factoryContract(signer);
  const token = new ethers.Contract(tokenAddress, ERC20StandardJson.abi, signer);
  const wei = ethers.utils.parseEther(String(amount));
  const approve = await token.approve(parameters.SOCIAL_TOKEN_FACTORY_ADDRESS, wei);
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
  const factory = factoryContract(signer);
  const token = new ethers.Contract(tokenAddress, ERC20StandardJson.abi, signer);
  const total = ethers.utils.parseEther(String(amountEach)).mul(recipients.length);
  const approve = await token.approve(parameters.SOCIAL_TOKEN_FACTORY_ADDRESS, total);
  await approve.wait(1);
  const tx = await factory.airdrop(
    tokenAddress,
    recipients,
    ethers.utils.parseEther(String(amountEach))
  );
  await tx.wait(1);
  return tx.hash;
}

/** Spot price in ETH per 1M tokens — the readable denomination for micro-caps. */
export async function tokenSpotPriceEthPerMillion(
  tokenAddress: string,
  provider: ethers.providers.Provider
): Promise<number> {
  const factory = factoryContract(provider);
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
    ethers.utils.parseEther(String(priceEth))
  );
  const receipt = await tx.wait(1);
  const ev = receipt.events?.find((e: any) => e.event === 'EditionCreated');
  return { edition: ev?.args?.edition, txHash: tx.hash };
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
    ethers.utils.parseEther(String(priceEth))
  );
  const receipt = await tx.wait(1);
  const ev = receipt.events?.find((e: any) => e.event === 'EditionCreated');
  return { edition: ev?.args?.edition, txHash: tx.hash };
}

/** Mint one from an edition — the minter pays price + gas; 1% to the platform. */
export async function mintEdition(
  editionAddress: string,
  priceEth: number,
  signer: Signer
): Promise<string> {
  const launcher = launcherContract(signer);
  const tx = await launcher.mint(editionAddress, {
    value: ethers.utils.parseEther(String(priceEth)),
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
  const tx = await router.buy(tokenAddress, 0, { value: ethers.utils.parseEther(String(ethAmount)) });
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
  const amount = ethers.utils.parseEther(String(tokenAmount));
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
