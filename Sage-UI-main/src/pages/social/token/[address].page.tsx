import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { useSigner, useProvider } from 'wagmi';
import LoaderDots from '@/components/LoaderDots';
import SocialShell from '@/components/Social/SocialShell';
import PriceChart from '@/components/Social/PriceChart';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { buyToken, sellToken, tokenBalanceOf } from '@/utilities/socialToken';
import {
  useGetTokenDetailQuery,
  useRecordTradeMutation,
  useCreatePostMutation,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const fmt = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);

export default function TokenDetailPage() {
  const router = useRouter();
  const address = (router.query.address as string) || '';
  const { walletAddress, isSignedIn } = useSAGEAccount();
  const { data: signer } = useSigner();
  const provider = useProvider();
  const { data, isFetching } = useGetTokenDetailQuery(address, {
    skip: !address,
    pollingInterval: 8_000,
  });
  const [recordTrade] = useRecordTradeMutation();
  const [createPost] = useCreatePostMutation();
  const [busy, setBusy] = useState(false);
  const [myBalance, setMyBalance] = useState<number | null>(null);

  const t = data?.token;
  useEffect(() => {
    if (t?.tokenAddress && walletAddress && provider) {
      tokenBalanceOf(t.tokenAddress, walletAddress, provider as any).then(setMyBalance).catch(() => {});
    }
  }, [t?.tokenAddress, walletAddress, provider]);

  if (isFetching && !data)
    return (
      <SocialShell>
        <LoaderDots />
      </SocialShell>
    );
  if (!t)
    return (
      <SocialShell>
        <div className='social'>
          <div className='social__empty'>Token not found.</div>
        </div>
      </SocialShell>
    );

  const creatorName = t.creator.username
    ? transformTitle(t.creator.username)
    : shortenAddress(t.creator.address);
  const isCreator = !!walletAddress && walletAddress.toLowerCase() === t.creator.address.toLowerCase();

  const refreshBalance = () => {
    if (t.tokenAddress && walletAddress && provider)
      tokenBalanceOf(t.tokenAddress, walletAddress, provider as any).then(setMyBalance).catch(() => {});
  };

  const buy = async () => {
    if (!signer) { toast.info('Connect your wallet'); return; }
    if (data?.complete) { toast.info('Curve sold out — this token has graduated'); return; }
    const raw = window.prompt(`Buy $${t.symbol} — how much ETH?`, '0.01');
    if (!raw) return;
    const amt = Number(raw);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    setBusy(true);
    const toastId = toast.loading(`Buying $${t.symbol}…`);
    try {
      const txHash = await buyToken(t.tokenAddress, amt, signer as any);
      const myAddr = await (signer as any).getAddress().catch(() => '');
      await recordTrade({ tokenAddress: t.tokenAddress, side: 'buy', txHash, ethAmount: amt, trader: myAddr });
      toast.update(toastId, { render: `Bought $${t.symbol} 🎉`, type: 'success', isLoading: false, autoClose: 4000 });
      refreshBalance();
    } catch (e: any) {
      toast.update(toastId, { render: e?.message?.slice(0, 80) || 'Buy failed', type: 'error', isLoading: false, autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  };

  const sell = async () => {
    if (!signer) { toast.info('Connect your wallet'); return; }
    if (!myBalance || myBalance <= 0) { toast.info(`You hold no $${t.symbol}`); return; }
    const raw = window.prompt(`Sell $${t.symbol} — how many tokens? (you hold ${fmt(myBalance)})`, String(Math.floor(myBalance)));
    if (!raw) return;
    const amt = Number(raw);
    if (!amt || amt <= 0 || amt > myBalance) { toast.error('Enter a valid amount'); return; }
    setBusy(true);
    const toastId = toast.loading(`Selling $${t.symbol}…`);
    try {
      const txHash = await sellToken(t.tokenAddress, amt, signer as any);
      const myAddr = await (signer as any).getAddress().catch(() => '');
      await recordTrade({ tokenAddress: t.tokenAddress, side: 'sell', txHash, tokenAmount: amt, trader: myAddr });
      toast.update(toastId, { render: `Sold $${t.symbol}`, type: 'success', isLoading: false, autoClose: 4000 });
      refreshBalance();
    } catch (e: any) {
      toast.update(toastId, { render: e?.message?.slice(0, 80) || 'Sell failed', type: 'error', isLoading: false, autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!isSignedIn) { toast.info('Connect your wallet to post'); return; }
    const url = `${window.location.origin}/social/token/${t.tokenAddress}`;
    const text = isCreator
      ? `I launched $${t.symbol} — ${t.name} 🚀 buy it on the SAGE Social curve:\n${url}`
      : `Aping $${t.symbol} on SAGE Social 🚀\n${url}`;
    try {
      await createPost({ text }).unwrap();
      toast.success('Shared to your feed 🎉');
    } catch (e: any) {
      toast.error(e?.data?.error || 'Could not share');
    }
  };

  return (
    <SocialShell>
      <div className='social social--token'>
        <button className='social__back' onClick={() => router.back()}>← back</button>

        <div className='token-page__head'>
          {t.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className='token-page__art' src={t.imageUrl} alt={t.name} />
          ) : (
            <div className='token-page__art token-page__art--ph'>${t.symbol.slice(0, 3)}</div>
          )}
          <div className='token-page__id'>
            <h1>
              ${t.symbol} <span className='token-page__name'>{t.name}</span>
            </h1>
            <button className='token-page__creator' onClick={() => router.push(`/social/${t.creator.address}`)}>
              by {creatorName}
              {t.creator.verified && <VerifiedBadge size={12} />}
            </button>
            {!t.airdropEnabled && <span className='token-page__badge'>🔒 no-dump launch</span>}
          </div>
          <button className='token-page__share' onClick={share}>Share to feed</button>
        </div>

        <div className='token-page__stats'>
          <div><span>Price</span><b>{data?.priceEth ? data.priceEth.toPrecision(3) : '0'} <em>ETH/1M</em></b></div>
          <div><span>Holders</span><b>{data?.holderCount ?? 0}</b></div>
          <div><span>Trades</span><b>{data?.tradeCount ?? 0}</b></div>
          <div><span>Status</span><b>{data?.complete ? 'Graduated' : 'On curve'}</b></div>
        </div>

        <PriceChart series={(data?.series || []).map((p) => ({ t: p.t, price: p.price }))} />

        <div className='token-page__curve'>
          <div className='token-page__curve-head'>
            <span>Bonding curve</span>
            <span>{data?.bondingProgressPct ?? 0}% sold</span>
          </div>
          <div className='token-page__curve-bar'>
            <div className='token-page__curve-fill' style={{ width: `${data?.bondingProgressPct ?? 0}%` }} />
          </div>
          <p className='token-page__curve-note'>
            {data?.complete
              ? 'Sold out — the curve has graduated.'
              : 'When the curve sells out the token graduates. Early buyers are further down the curve.'}
          </p>
        </div>

        <div className='token-page__trade'>
          <button className='token-page__buy' disabled={busy || data?.complete} onClick={buy}>Buy ${t.symbol}</button>
          <button className='token-page__sell' disabled={busy} onClick={sell}>
            Sell{myBalance ? ` · ${fmt(myBalance)}` : ''}
          </button>
        </div>

        <div className='token-page__cols'>
          <div className='token-page__col'>
            <h4>Holders</h4>
            {data?.holders.length ? (
              data.holders.map((h, i) => (
                <div key={h.user.address} className='token-page__row' onClick={() => router.push(`/social/${h.user.address}`)}>
                  <span className='token-page__rank'>{i + 1}</span>
                  <span className='token-page__holder'>
                    {h.user.username ? transformTitle(h.user.username) : shortenAddress(h.user.address)}
                    {h.user.verified && <VerifiedBadge size={11} />}
                  </span>
                  <span className='token-page__bal'>{fmt(h.balance)}</span>
                </div>
              ))
            ) : (
              <p className='social__empty'>No holders yet.</p>
            )}
          </div>
          <div className='token-page__col'>
            <h4>Trades</h4>
            {data?.trades.length ? (
              data.trades.map((tr, i) => (
                <div key={i} className='token-page__row'>
                  <span className={`token-page__side token-page__side--${tr.side}`}>{tr.side}</span>
                  <span className='token-page__holder'>{shortenAddress(tr.trader)}</span>
                  <span className='token-page__bal'>{tr.ethAmount.toPrecision(2)} ETH</span>
                  <span className='token-page__ago'>{timeAgo(tr.createdAt)}</span>
                </div>
              ))
            ) : (
              <p className='social__empty'>No trades yet.</p>
            )}
          </div>
        </div>
      </div>
    </SocialShell>
  );
}
