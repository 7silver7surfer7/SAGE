/**
 * Telling a person's wallet apart from a contract.
 *
 * `getCode(addr) === '0x'` was the whole test, and EIP-7702 broke it. A
 * delegated EOA is still a person — the same key still signs — but it now
 * carries code: the 23-byte designator 0xef0100 || address. Any filter looking
 * for empty code classifies it as a contract and drops it.
 *
 * That is not hypothetical here. Of the new SAGE token's user-held supply,
 * 8,136,737,178 of 8,228,345,650 tokens (98.89%) sit in 7702-delegated wallets
 * on Robinhood mainnet. Holder discovery keyed on `code === '0x'` sees 1.11% of
 * the float, so pointing points accrual at that token without this fix would
 * pay essentially nobody while looking like it worked.
 *
 * Kept in one file because the failure is silent: a wrong answer here does not
 * throw, it just quietly omits people.
 */

/** EIP-7702 delegation designator: 0xef0100 ++ 20-byte implementation address. */
const DELEGATION_PREFIX = '0xef0100';
const DELEGATION_CODE_LENGTH = 2 + 23 * 2; // '0x' + 23 bytes

/** True when `code` is an EIP-7702 delegation designator rather than a contract. */
export function isDelegatedEoaCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.toLowerCase();
  return c.startsWith(DELEGATION_PREFIX) && c.length === DELEGATION_CODE_LENGTH;
}

/**
 * True when the address is controlled by a private key — plain EOA or
 * 7702-delegated.
 *
 * Pass the result of `getCode`. A null/undefined code means the lookup FAILED,
 * and this returns false so a transient RPC error can never be mistaken for
 * "definitely a person" and admit a contract.
 */
export function isUserWalletCode(code: string | null | undefined): boolean {
  if (code === '0x') return true;
  return isDelegatedEoaCode(code);
}

/** The 7702 implementation an EOA points at, or null. Diagnostics only. */
export function delegationTarget(code: string | null | undefined): string | null {
  if (!isDelegatedEoaCode(code)) return null;
  return '0x' + String(code).slice(DELEGATION_PREFIX.length);
}
