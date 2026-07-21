import { ethers, Signer } from 'ethers';
import faucetJson from '@/constants/abis/Social/SocialFaucet.sol/SocialFaucet.json';
import ERC20StandardJson from '@/constants/abis/ERC-20/ERC20Standard.json';
import { parameters } from '@/constants/config';

export const FAUCET_ENABLED = !!parameters.SOCIAL_FAUCET_ADDRESS;

export function faucetContract(signerOrProvider: Signer | ethers.providers.Provider) {
  return new ethers.Contract(parameters.SOCIAL_FAUCET_ADDRESS, faucetJson.abi, signerOrProvider);
}

export interface FaucetStatus {
  active: boolean;
  dripAmount: number;
  balance: number;
  hasClaimed: boolean; // true once this wallet has ever claimed — it's a one-shot, not a cooldown
}

/**
 * Everything the claim button needs, in one read. `address` is optional —
 * the drip size and tank balance are wallet-independent and should render
 * before a wallet is even connected; only hasClaimed needs one.
 */
export async function getFaucetStatus(
  provider: ethers.providers.Provider,
  address?: string
): Promise<FaucetStatus> {
  const faucet = faucetContract(provider);
  const sage = new ethers.Contract(parameters.ASHTOKEN_ADDRESS, ERC20StandardJson.abi, provider);
  const [active, dripAmount, balance, hasClaimed] = await Promise.all([
    faucet.active(),
    faucet.dripAmount(),
    sage.balanceOf(parameters.SOCIAL_FAUCET_ADDRESS),
    address ? faucet.claimed(address) : false,
  ]);
  return {
    active,
    dripAmount: Number(ethers.utils.formatEther(dripAmount)),
    balance: Number(ethers.utils.formatEther(balance)),
    hasClaimed,
  };
}

/**
 * Redeem a server-issued voucher for this wallet's one lifetime claim.
 * Reverts (paused / already claimed / empty tank / invalid voucher) surface
 * via humanWalletError.
 */
export async function claimFaucet(signature: string, signer: Signer): Promise<string> {
  const faucet = faucetContract(signer);
  const tx = await faucet.claim(signature);
  await tx.wait(1);
  return tx.hash;
}

// ───────────── admin-only (contract owner) ─────────────

export async function isFaucetOwner(address: string, provider: ethers.providers.Provider): Promise<boolean> {
  if (!address) return false;
  const owner: string = await faucetContract(provider).owner();
  return owner.toLowerCase() === address.toLowerCase();
}

export async function setFaucetActive(active: boolean, signer: Signer): Promise<string> {
  const tx = await faucetContract(signer).setActive(active);
  await tx.wait(1);
  return tx.hash;
}

export async function setFaucetDripAmount(amount: number, signer: Signer): Promise<string> {
  const tx = await faucetContract(signer).setDripAmount(ethers.utils.parseEther(String(amount)));
  await tx.wait(1);
  return tx.hash;
}

/** Rotate the platform voucher-signing key (only needed if that key ever changes). */
export async function setFaucetVoucherSigner(voucherSigner: string, signer: Signer): Promise<string> {
  const tx = await faucetContract(signer).setVoucherSigner(voucherSigner);
  await tx.wait(1);
  return tx.hash;
}

/** Drain the faucet's SAGE to `to` — amount=0 drains the entire balance. */
export async function drainFaucet(to: string, amount: number, signer: Signer): Promise<string> {
  const tx = await faucetContract(signer).drain(to, amount > 0 ? ethers.utils.parseEther(String(amount)) : 0);
  await tx.wait(1);
  return tx.hash;
}
