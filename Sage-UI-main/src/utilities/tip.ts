import { ethers, Signer } from 'ethers';
import ERC20StandardJson from '@/constants/abis/ERC-20/ERC20Standard.json';
import { parameters } from '@/constants/config';

/**
 * Tips a post author directly in SAGE. This is a plain ERC-20 `transfer`
 * from the tipper's wallet to the author's wallet — no marketplace contract,
 * no allowance/approve step. Returns the mined tx hash so the caller can
 * record the tip server-side (RecordTip) and bump the post's tip total.
 */
export async function tipSage(
  toAddress: string,
  amountSage: number,
  signer: Signer
): Promise<string> {
  const token = new ethers.Contract(parameters.ASHTOKEN_ADDRESS, ERC20StandardJson.abi, signer);
  const value = ethers.utils.parseEther(String(amountSage));
  const tx = await token.transfer(toAddress, value);
  await tx.wait(1);
  return tx.hash;
}
