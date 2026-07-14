import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { useSigner, useProvider } from 'wagmi';
import LoaderDots from '@/components/LoaderDots';
import SocialShell from '@/components/Social/SocialShell';
import CandleChart from '@/components/Social/CandleChart';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { buyToken, sellToken, tokenBalanceOf } from '@/utilities/socialToken';
import { humanWalletError } from '@/utilities/walletError';
import { utils } from 'ethers';
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
  const { data, isFetching, refetch } = useGetTokenDetailQuery(address, {
    skip: !address,
    pollingInterval: 10_000, // reconcile only — the candle tape streams from chain events
  });
  const [recordTrade] = useRecordTradeMutation();
  const [bucketS, setBucketS] = useState(60); // 1m default, pump.fun-style
  // pump.fun-style trade widget
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('0.01'); // ETH (buy) / tokens (sell)
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
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    // pre-flight: raw wallet reverts read as 'Internal JSON-RPC error'
    const bal = await (signer as any).getBalance();
    if (bal.lt(utils.parseEther(String(amt)))) {
      toast.error(`Not enough ETH — you need ${amt}, you have ${(+utils.formatEther(bal)).toFixed(5)}`);
      return;
    }
    setBusy(true);
    const toastId = toast.loading(`Buying $${t.symbol}…`);
    try {
      const txHash = await buyToken(t.tokenAddress, amt, signer as any);
      const myAddr = await (signer as any).getAddress().catch(() => '');
      await recordTrade({ tokenAddress: t.tokenAddress, side: 'buy', txHash, ethAmount: amt, trader: myAddr });
      toast.update(toastId, { render: `Bought $${t.symbol} 🎉`, type: 'success', isLoading: false, autoClose: 4000 });
      refreshBalance();
    } catch (e: any) {
      toast.update(toastId, { render: `Buy failed — ${humanWalletError(e, amt)}`, type: 'error', isLoading: false, autoClose: 7000 });
    } finally {
      setBusy(false);
    }
  };

  const sell = async () => {
    if (!signer) { toast.info('Connect your wallet'); return; }
    if (!myBalance || myBalance <= 0) { toast.info(`You hold no $${t.symbol}`); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0 || amt > myBalance) { toast.error(`Enter a valid amount (you hold ${fmt(myBalance)})`); return; }
    setBusy(true);
    const toastId = toast.loading(`Selling $${t.symbol}…`);
    try {
      const txHash = await sellToken(t.tokenAddress, amt, signer as any);
      const myAddr = await (signer as any).getAddress().catch(() => '');
      await recordTrade({ tokenAddress: t.tokenAddress, side: 'sell', txHash, tokenAmount: amt, trader: myAddr });
      toast.update(toastId, { render: `Sold $${t.symbol}`, type: 'success', isLoading: false, autoClose: 4000 });
      refreshBalance();
    } catch (e: any) {
      toast.update(toastId, { render: `Sell failed — ${humanWalletError(e)}`, type: 'error', isLoading: false, autoClose: 7000 });
    } finally {
      setBusy(false);
    }
  };

  const shareX = () => {
    const url = `${window.location.origin}/social/token/${t.tokenAddress}`;
    const text = `$${t.symbol} — ${t.name} on SAGE Social 🚀\n${url}`;
    // pre-drafted tweet: opens X's composer, nothing is sent for them
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
  };

  const copyCa = () => {
    navigator.clipboard.writeText(t.tokenAddress);
    toast.success('Contract address copied');
  };

  const share = () => {
    if (!isSignedIn) { toast.info('Connect your wallet to post'); return; }
    const url = `${window.location.origin}/social/token/${t.tokenAddress}`;
    const text = isCreator
      ? `I launched $${t.symbol} — ${t.name} 🚀 buy it on the SAGE Social curve:\n${url}`
      : `Aping $${t.symbol} on SAGE Social 🚀\n${url}`;
    // open a DRAFT in the composer — the user edits, then posts
    router.push(`/social/compose?draft=${encodeURIComponent(text)}`);
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
              {t.name} <span className='token-page__name'>${t.symbol}</span>
            </h1>
            <div className='token-page__meta-row'>
              <button className='token-page__creator' onClick={() => router.push(`/social/${t.creator.address}`)}>
                <span className='token-page__creator-avatar'>
                  <PfpImage src={t.creator.profilePicture} />
                </span>
                {creatorName}
                {t.creator.verified && <VerifiedBadge size={12} />}
              </button>
              <button className='token-page__ca' title='Copy contract address' onClick={copyCa}>
                {t.tokenAddress.slice(0, 6)}…{t.tokenAddress.slice(-4)} ⧉
              </button>
              {!t.airdropEnabled && <span className='token-page__badge'>🔒 no-dump</span>}
            </div>
            {t.description && <p className='token-page__desc'>{t.description}</p>}
            {t.website && (
              <a
                className='token-page__ca token-page__website'
                href={t.website}
                target='_blank'
                rel='noreferrer noopener'
              >
                🌐 {t.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 32)}
              </a>
            )}
          </div>
          <div className='token-page__share-col'>
            <button className='token-page__share' onClick={share}>Share to feed</button>
            <button className='token-page__share token-page__share--x' onClick={shareX}>Share on 𝕏</button>
          </div>
        </div>

        {/* pump.fun-style market header: big mcap + 24h change + ATH bar */}
        {(() => {
          const ethUsd = data?.ethUsd || 0;
          const mcap = (data?.priceEth || 0) * 1000 * ethUsd;
          const mcapAgo = (data?.price24hAgoEth || 0) * 1000 * ethUsd;
          const diff = mcap - mcapAgo;
          const pct = mcapAgo > 0 ? (diff / mcapAgo) * 100 : 0;
          const ath = Math.max((data?.athPriceEth || 0) * 1000 * ethUsd, mcap);
          const fmtUsd = (v: number) =>
            v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(2)}`;
          return (
            <div className='token-page__mcap'>
              <span className='token-page__mcap-label'>Market cap</span>
              <div className='token-page__mcap-row'>
                <b className='token-page__mcap-value'>{fmtUsd(mcap)}</b>
                <span className='token-page__mcap-change' data-up={diff >= 0}>
                  {diff >= 0 ? '+' : '−'}{fmtUsd(Math.abs(diff)).replace('$', '$')} ({diff >= 0 ? '+' : ''}
                  {pct.toFixed(2)}%) <em>24hr</em>
                </span>
                <div className='token-page__ath'>
                  <div className='token-page__ath-bar'>
                    <div
                      className='token-page__ath-fill'
                      style={{ width: `${ath > 0 ? Math.min(100, (mcap / ath) * 100) : 0}%` }}
                    />
                  </div>
                  <span className='token-page__ath-label'>ATH <b>{fmtUsd(ath)}</b></span>
                </div>
              </div>
            </div>
          );
        })()}

        <div className='token-page__stats'>
          <div><span>Price</span><b>{data?.priceEth ? data.priceEth.toPrecision(3) : '0'} <em>ETH/1M</em></b></div>
          <div><span>Holders</span><b>{data?.holderCount ?? 0}</b></div>
          <div><span>Trades</span><b>{data?.tradeCount ?? 0}</b></div>
          <div><span>Status</span><b>{data?.complete ? 'Graduated' : 'On curve'}</b></div>
        </div>

        {/* timeframe switcher */}
        <div className='token-page__tf'>
          {[
            [60, '1m'],
            [300, '5m'],
            [900, '15m'],
            [3600, '1h'],
          ].map(([sec, label]) => (
            <button
              key={sec}
              data-active={bucketS === sec}
              onClick={() => setBucketS(sec as number)}
            >
              {label}
            </button>
          ))}
        </div>

        <CandleChart
          series={(data?.series || []).map((p) => ({ t: p.t, price: p.price }))}
          trades={(data?.trades || []).map((tr) => ({
            side: tr.side,
            ethAmount: tr.ethAmount,
            createdAt: tr.createdAt,
          }))}
          tokenAddress={t.tokenAddress}
          onLiveTrade={() => refetch()}
          bucketS={bucketS}
          // chart in USD MARKET CAP (pump.fun-style); falls back to raw ETH
          // if the price feed is down
          scaleFactor={data?.ethUsd ? 1000 * data.ethUsd : 1}
        />

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

        {/* pump.fun-style trade widget */}
        <div className='token-trade'>
          <div className='token-trade__tabs'>
            <button data-active={side === 'buy'} data-side='buy' onClick={() => { setSide('buy'); setAmount('0.01'); }}>
              Buy
            </button>
            <button data-active={side === 'sell'} data-side='sell' onClick={() => { setSide('sell'); setAmount(myBalance ? String(Math.floor(myBalance)) : '0'); }}>
              Sell
            </button>
          </div>
          <div className='token-trade__amount'>
            <input
              value={amount}
              inputMode='decimal'
              onChange={(e) => setAmount(e.target.value)}
            />
            <span>{side === 'buy' ? 'ETH' : `$${t.symbol}`}</span>
          </div>
          {side === 'buy' && data?.ethUsd ? (
            <p className='token-trade__hint'>≈ ${((Number(amount) || 0) * data.ethUsd).toFixed(2)}</p>
          ) : side === 'sell' ? (
            <p className='token-trade__hint'>you hold {fmt(myBalance || 0)}</p>
          ) : null}
          <div className='token-trade__presets'>
            {side === 'buy'
              ? [25, 100, 250].map((usd) => (
                  <button
                    key={usd}
                    data-side='buy'
                    onClick={() =>
                      data?.ethUsd && setAmount((usd / data.ethUsd).toFixed(5))
                    }
                  >
                    ${usd}
                  </button>
                ))
              : [25, 50, 100].map((pct) => (
                  <button
                    key={pct}
                    data-side='sell'
                    onClick={() => myBalance && setAmount(String(Math.floor((myBalance * pct) / 100)))}
                  >
                    {pct}%
                  </button>
                ))}
          </div>
          <button
            className='token-trade__cta'
            data-side={side}
            disabled={busy || (side === 'buy' && data?.complete)}
            onClick={() => {
              if (!signer) { toast.info('Connect your wallet to trade'); return; }
              if (side === 'buy') buy();
              else sell();
            }}
          >
            {!signer
              ? 'Connect wallet to trade'
              : side === 'buy'
              ? data?.complete
                ? 'Graduated — buys closed'
                : `Buy $${t.symbol}`
              : `Sell $${t.symbol}`}
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
