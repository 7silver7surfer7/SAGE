import { ethers } from 'ethers';
import { robinhood } from '@/constants/chains';
import {
  TRADE_CHAIN_ID,
  TRADE_CHAIN_NAME,
  TRADE_RPC_URL,
  TRADE_ROUTER_ADDRESS,
  TRADE_DEX_ROUTER_ADDRESS,
  TRADE_WETH_ADDRESS,
  TRADE_FACTORY_ADDRESSES,
  SAGE_PRICE_TOKEN_ADDRESS,
  parameters,
} from '@/constants/config';
import type { VenueOptions } from '@/utilities/socialToken';

/**
 * The agent's trading venue: Robinhood MAINNET, always.
 *
 * Deliberately not `parameters` — a staging or localhost build reads staging's
 * database but must still route real orders at mainnet addresses. Mixing the
 * two is what broke the first live buy: the mainnet SAGE address signed
 * against chain 46630, where it has no code, which ethers reports only as
 * `call revert exception`. Testnet is not a usable fallback either — SAGE was
 * never launched on the testnet factory, so there is nothing there to buy.
 */
export const TRADE_VENUE: VenueOptions = {
  factories: TRADE_FACTORY_ADDRESSES,
  router: TRADE_ROUTER_ADDRESS,
  // Reaches the ~21.7k pairs on the chain that SAGE did not launch.
  dexRouter: TRADE_DEX_ROUTER_ADDRESS,
  weth: TRADE_WETH_ADDRESS,
};

/**
 * Which chain a given route expects the wallet to be on.
 *
 * The rest of the app is single-chain: it wants the wallet on whatever
 * `parameters` was built for. /agent is the exception — it trades mainnet from
 * every build, so on a staging or localhost build the two disagree, and the
 * app's own wrong-network toast would fight the switch the agent just made,
 * telling the user to go back to testnet mid-order.
 */
export function expectedChainForPath(pathname: string): { id: number; name: string } {
  const isAgent = pathname.startsWith('/agent') && !pathname.startsWith('/agent-api');
  return isAgent
    ? { id: TRADE_CHAIN_ID, name: TRADE_CHAIN_NAME }
    : { id: Number(parameters.CHAIN_ID), name: String(parameters.NETWORK_NAME) };
}

/** Read-only mainnet provider — quotes, curve state, token metadata. */
export function tradeProvider(): ethers.providers.Provider {
  return new ethers.providers.StaticJsonRpcProvider(TRADE_RPC_URL, TRADE_CHAIN_ID);
}

/** Symbols the agent knows without a database lookup. */
export const BUILTIN_TOKENS: Record<string, string> = {
  SAGE: SAGE_PRICE_TOKEN_ADDRESS,
};

export function explorerTx(hash: string): string {
  return `${robinhood.blockExplorers?.default.url}/tx/${hash}`;
}

/**
 * Put the wallet on the trading chain, and hand back a signer that is actually
 * bound to it.
 *
 * The returned signer matters: after a network switch the original one is
 * still attached to a provider that cached the OLD network, so reusing it
 * sends the transaction to the chain the user just left. This rebuilds the
 * provider from the underlying EIP-1193 connection once the switch is
 * observed, so callers can only ever hold a correct signer.
 */
export async function ensureTradeChain(signer: ethers.Signer): Promise<ethers.Signer> {
  const current = await signer.getChainId();
  if (current === TRADE_CHAIN_ID) return signer;

  const eip1193: any = (signer.provider as any)?.provider;
  if (!eip1193?.request) {
    throw new Error(
      `wallet is on chain ${current} — switch it to ${TRADE_CHAIN_NAME} to trade`
    );
  }

  const chainId = ethers.utils.hexValue(TRADE_CHAIN_ID);
  try {
    await eip1193.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (err: any) {
    // 4902: the wallet has never heard of this chain. Some wallets nest the
    // real code under data.originalError instead of surfacing it directly.
    const code = err?.code ?? err?.data?.originalError?.code;
    if (code === 4902) {
      await eip1193.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId,
            chainName: robinhood.name,
            nativeCurrency: robinhood.nativeCurrency,
            rpcUrls: [robinhood.rpcUrls.default],
            blockExplorerUrls: [robinhood.blockExplorers?.default.url],
          },
        ],
      });
    } else if (code === 4001) {
      throw new Error(`network switch declined — ${TRADE_CHAIN_NAME} is required to trade`);
    } else {
      throw new Error(
        `could not switch to ${TRADE_CHAIN_NAME}: ${err?.message || 'wallet refused the request'}`
      );
    }
  }

  // Wallets resolve the switch request before the change lands. Wait for the
  // connection itself to report the new chain rather than trusting the ack.
  for (let i = 0; i < 20; i++) {
    const now = parseInt(await eip1193.request({ method: 'eth_chainId' }), 16);
    if (now === TRADE_CHAIN_ID) {
      return new ethers.providers.Web3Provider(eip1193, 'any').getSigner();
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`wallet did not switch to ${TRADE_CHAIN_NAME} — change the network and retry`);
}

/**
 * Transaction hashes for display.
 *
 * A real hash is 66 characters. The design only ever held pre-shortened
 * strings, so nothing truncated them — and the first genuine transaction ran
 * straight out of its column and over the text beside it.
 */
export function shortHash(hash?: string): string {
  if (!hash) return '';
  return hash.length > 20 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}
