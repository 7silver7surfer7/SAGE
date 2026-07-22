import { Contract, Signer, BigNumberish } from 'ethers';

/**
 * Client helpers for voucher-gated minting. The server (GetGameVoucher) checks
 * eligibility off-chain and returns a platform-signed voucher; the wallet
 * redeems it itself (its own gas) via batchMintWithVoucher / buyTicketsWithVoucher.
 * No on-chain whitelist, zero server gas.
 */
export interface GameVoucher {
  signature: string;
  deadline: number;
  contractAddress: string;
  onchainId: number;
}

/** Ask the server for a signed voucher for this open edition / lottery. */
export async function requestGameVoucher(
  game: 'oe' | 'lottery',
  recordId: number
): Promise<GameVoucher> {
  const res = await fetch(`/api/drops?action=GetGameVoucher&game=${game}&recordId=${recordId}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || 'could not get a mint voucher');
  return body as GameVoucher;
}

const OE_VOUCHER_ABI = [
  'function batchMintWithVoucher(uint256 _id, uint256 _amount, uint256 _deadline, bytes _sig) payable',
];
const LOTTERY_VOUCHER_ABI = [
  'function buyTicketsWithVoucher(uint256 _lotteryId, uint256 _numberOfTicketsToBuy, uint256 _deadline, bytes _sig) payable',
];

/** Redeem an OE voucher: mints `amount` to the caller, paying only their gas
 *  (+ msg.value for ETH-priced editions). Returns the tx hash. */
export async function mintOpenEditionWithVoucher(
  v: GameVoucher,
  amount: number,
  signer: Signer,
  value: BigNumberish = 0
): Promise<string> {
  const c = new Contract(v.contractAddress, OE_VOUCHER_ABI, signer);
  const tx = await c.batchMintWithVoucher(v.onchainId, amount, v.deadline, v.signature, { value });
  await tx.wait(1);
  return tx.hash;
}

/** Redeem a lottery voucher: buys `count` tickets for the caller. */
export async function buyTicketsWithVoucher(
  v: GameVoucher,
  count: number,
  signer: Signer,
  value: BigNumberish = 0
): Promise<string> {
  const c = new Contract(v.contractAddress, LOTTERY_VOUCHER_ABI, signer);
  const tx = await c.buyTicketsWithVoucher(v.onchainId, count, v.deadline, v.signature, { value });
  await tx.wait(1);
  return tx.hash;
}
