import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { useSigner, useProvider } from 'wagmi';
import {
  useGetProfileTokenQuery,
  useRecordTokenLaunchMutation,
  useRecordAirdropMutation,
  useToggleHideItemMutation,
} from '@/store/socialReducer';
import {
  launchToken,
  buyToken,
  airdropToken,
  tokenSpotPriceEthPerMillion,
} from '@/utilities/socialToken';
import VerificationModal from './VerificationModal';
import { useRecordTradeMutation } from '@/store/socialReducer';
import { humanWalletError } from '@/utilities/walletError';

/** Launch modal — a verified creator mints their coin (pays the launch fee). */
function LaunchModal({ onClose }: { onClose: () => void }) {
  const { data: signer } = useSigner();
  const [record] = useRecordTokenLaunchMutation();
  const [recordTrade] = useRecordTradeMutation();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  // pump.fun-style dev buy: the launch tx can carry ETH that executes as the
  // FIRST buy on the fresh curve — seeds the chart and makes you holder #1
  const [initialBuy, setInitialBuy] = useState('0.01');
  const [description, setDescription] = useState('');
  // default OFF: no-dump launches are the norm — opting IN reserves the 2%
  const [withAirdrop, setWithAirdrop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needVerify, setNeedVerify] = useState(false);

  const go = async () => {
    if (!signer) { toast.info('Connect your wallet'); return; }
    if (!name.trim() || !symbol.trim()) { toast.error('Name and symbol required'); return; }
    const buyEth = Number(initialBuy) || 0;
    if (buyEth < 0) { toast.error('Initial buy cannot be negative'); return; }
    setBusy(true);
    const t = toast.loading(buyEth > 0 ? `Launching + buying ${buyEth} ETH…` : 'Launching your coin… (free — you only pay gas)');
    try {
      const { token, txHash, devBuy } = await launchToken(name.trim(), symbol.trim().toUpperCase(), withAirdrop, signer as any, buyEth);
      await record({ tokenAddress: token, name: name.trim(), symbol: symbol.trim().toUpperCase(), launchTxHash: txHash, airdropEnabled: withAirdrop, description: description.trim() || undefined }).unwrap();
      if (devBuy) {
        // the dev buy is a real Bought event in the launch tx — record it so
        // the chart, holders and trades all start seeded
        await recordTrade({ tokenAddress: token, side: 'buy', txHash }).unwrap().catch(() => {});
      }
      toast.update(t, { render: `$${symbol.toUpperCase()} is live 🚀${devBuy ? ' — you are holder #1' : ''}`, type: 'success', isLoading: false, autoClose: 5000 });
      onClose();
    } catch (err: any) {
      if (err?.data?.needsVerification) { setNeedVerify(true); toast.dismiss(t); }
      else toast.update(t, { render: err?.data?.error || `Launch failed — ${humanWalletError(err)}`, type: 'error', isLoading: false, autoClose: 7000 });
    } finally {
      setBusy(false);
    }
  };

  if (needVerify) return <VerificationModal onClose={onClose} />;
  return (
    <div className='social-verify__overlay' onClick={onClose}>
      <div className='social-verify social-verify--launch' onClick={(e) => e.stopPropagation()}>
        <div className='social-verify__head'>
          <h3>🚀 Launch your coin</h3>
          <button className='social-verify__close' onClick={onClose}>✕</button>
        </div>
        <p className='social-verify__blurb'>
          The pump.fun bonding curve, ported to ETH: 1B supply, 793.1M sold off the curve,
          graduation when it sells out. Launching is FREE (gas only). Every trade pays a 1%
          fee — 0.05% streams back to YOU, the rest to the platform.
        </p>
        <input className='social-search__input' placeholder='Coin name (e.g. Chartreuse Gang)' value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 10 }} />
        <input className='social-search__input' placeholder='Ticker (e.g. CHRT)' value={symbol} maxLength={12} onChange={(e) => setSymbol(e.target.value.toUpperCase())} style={{ marginBottom: 12 }} />
        <textarea
          className='social-search__input'
          placeholder='One-liner about your coin (shown on its page)'
          value={description}
          maxLength={300}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          style={{ marginBottom: 12, resize: 'vertical', borderRadius: 16 }}
        />
        <label className='social-edit__label'>Initial buy — seeds your chart, makes you holder #1</label>
        <div className='social-unit-input' style={{ marginBottom: 12 }}>
          <input placeholder='0.01 (0 = skip)' value={initialBuy} onChange={(e) => setInitialBuy(e.target.value)} />
          <span>ETH</span>
        </div>
        <label className='social-profile__gate-row' style={{ marginBottom: 14 }}>
          <input
            type='checkbox'
            checked={withAirdrop}
            onChange={(e) => setWithAirdrop(e.target.checked)}
          />
          <span>
            Reserve 2% (20M) for follower airdrops
            <br />
            <small style={{ opacity: 0.65 }}>
              Off by default: you launch holding ZERO tokens — nothing can be dumped; every
              token is earned off the curve. Turn on only if you want an airdrop budget.
            </small>
          </span>
        </label>
        <button className='social-verify__buy' disabled={busy} onClick={go}>
          {busy ? 'Launching…' : 'Launch — free (gas only)'}
        </button>
      </div>
    </div>
  );
}

interface Props {
  address: string;
  isSelf: boolean;
  followers: string[];
}

export default function TokenPanel({ address, isSelf }: Props) {
  const router = useRouter();
  const { data } = useGetProfileTokenQuery(address, { skip: !address });
  const { data: signer } = useSigner();
  const provider = useProvider();
  const [recordAirdrop] = useRecordAirdropMutation();
  const [hideItem] = useToggleHideItemMutation();
  const [launchOpen, setLaunchOpen] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const token = data?.token;
  useEffect(() => {
    if (token?.tokenAddress && provider) {
      tokenSpotPriceEthPerMillion(token.tokenAddress, provider as any).then(setPrice).catch(() => {});
    }
  }, [token?.tokenAddress, provider]);

  // launchpad disabled on this network (no factory) → render nothing
  if (!data?.factory) return null;

  if (!token) {
    // no coin yet: only the profile owner sees the launch CTA
    if (!isSelf) return null;
    return (
      <div className='social-token'>
        <div className='social-token__empty'>
          <div>
            <h4>Launch your creator coin</h4>
            <p>Give your followers something to ape. pump.fun-style, on Robinhood Chain.</p>
          </div>
          <button className='social-token__launch' onClick={() => setLaunchOpen(true)}>🚀 Launch</button>
        </div>
        {launchOpen && <LaunchModal onClose={() => setLaunchOpen(false)} />}
      </div>
    );
  }

  const buy = async () => {
    if (!signer) { toast.info('Connect your wallet'); return; }
    const raw = window.prompt(`Buy $${token.symbol} — how much ETH?`, '0.01');
    if (!raw) return;
    const amt = Number(raw);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    setBusy(true);
    const t = toast.loading(`Buying $${token.symbol}…`);
    try {
      await buyToken(token.tokenAddress, amt, signer as any);
      toast.update(t, { render: `Bought $${token.symbol} 🎉`, type: 'success', isLoading: false, autoClose: 4000 });
      if (provider) tokenSpotPriceEthPerMillion(token.tokenAddress, provider as any).then(setPrice).catch(() => {});
    } catch (err: any) {
      toast.update(t, { render: `Buy failed — ${humanWalletError(err)}`, type: 'error', isLoading: false, autoClose: 7000 });
    } finally {
      setBusy(false);
    }
  };

  const airdrop = async () => {
    if (!signer) { toast.info('Connect your wallet'); return; }
    const recipients = data.followers;
    if (!recipients.length) { toast.info('No followers to airdrop yet'); return; }
    const raw = window.prompt(`Airdrop $${token.symbol} to ${recipients.length} followers — how many tokens EACH?`, '1000');
    if (!raw) return;
    const each = Number(raw);
    if (!each || each <= 0) { toast.error('Enter a valid amount'); return; }
    setBusy(true);
    const t = toast.loading(`Airdropping to ${recipients.length} followers…`);
    try {
      await airdropToken(token.tokenAddress, recipients, each, signer as any);
      await recordAirdrop({ count: recipients.length }).unwrap();
      toast.update(t, { render: `Airdropped ${each} $${token.symbol} to ${recipients.length} followers 🪂`, type: 'success', isLoading: false, autoClose: 5000 });
    } catch (err: any) {
      toast.update(t, { render: err?.message?.slice(0, 80) || 'Airdrop failed', type: 'error', isLoading: false, autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='social-token'>
      <div
        className='social-token__head social-token__head--link'
        onClick={() => router.push(`/social/token/${token.tokenAddress}`)}
      >
        <span className='social-token__ticker'>${token.symbol}</span>
        <span className='social-token__name'>{token.name}</span>
        {price !== null && (
          <span className='social-token__price'>
            {price ? price.toPrecision(3) : '0'} ETH / 1M
          </span>
        )}
        {isSelf && (
          <button
            className='social-hide-link'
            onClick={async (ev) => {
              ev.stopPropagation();
              if (!token) return;
              try {
                await hideItem({ kind: 'token', ref: token.tokenAddress.toLowerCase(), hide: true }).unwrap();
                toast.success('Token hidden from your profile');
              } catch { toast.error('Could not hide'); }
            }}
          >
            hide
          </button>
        )}
      </div>
      <div className='social-token__actions'>
        <button className='social-token__buy' disabled={busy} onClick={buy}>
          Buy ${token.symbol}
        </button>
        {isSelf && token.airdropEnabled && (
          <button className='social-token__airdrop' disabled={busy} onClick={airdrop}>
            🪂 Airdrop followers
          </button>
        )}
        {!token.airdropEnabled && (
          <span className='social-token__stat' title='Launched without a creator allocation'>
            🔒 no-dump launch
          </span>
        )}
      </div>
      {token.airdropCount > 0 && (
        <p className='social-token__stat'>{token.airdropCount} followers airdropped</p>
      )}
    </div>
  );
}
