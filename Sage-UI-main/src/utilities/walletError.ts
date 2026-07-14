/** Wallet/RPC errors in plain words — never surface 'Internal JSON-RPC error'. */
export function humanWalletError(err: any, priceEth?: number | string): string {
  const code = err?.code ?? err?.error?.code;
  const raw = String(err?.error?.message || err?.data?.message || err?.reason || err?.message || '');
  if (code === 4001 || code === 'ACTION_REJECTED' || /user (rejected|denied)/i.test(raw))
    return 'you cancelled the transaction';
  if (code === 'INSUFFICIENT_FUNDS' || /insufficient funds/i.test(raw))
    return `not enough ETH${priceEth ? ` (need ${priceEth} + gas)` : ' for this transaction + gas'}`;
  if (/internal json-rpc/i.test(raw))
    return 'the transaction failed — check your ETH balance covers the amount + gas';
  return raw.slice(0, 90) || 'transaction failed';
}
