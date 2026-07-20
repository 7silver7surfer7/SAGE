import { useEffect, useRef, useState } from 'react';
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
import {
  buyToken,
  sellToken,
  tokenBalanceOf,
  graduateToken,
  buyOnPool,
  sellOnPool,
  creatorFeesOf,
  claimCreatorFees,
} from '@/utilities/socialToken';
import { humanWalletError } from '@/utilities/walletError';
import { utils } from 'ethers';
import {
  useGetTokenDetailQuery,
  useGetTokenTradesPageQuery,
  useGetTokenHoldersPageQuery,
  useRecordTradeMutation,
  useCreatePostMutation,
} from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import { toDecimalString } from '@/utilities/decimalString';

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
  // pause the reconcile poll while the tab is hidden — parked tabs were a
  // pure server cost (RTK 1.6 predates skipPollingIfUnfocused, so hand-roll)
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const on = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  const { data, isFetching, refetch } = useGetTokenDetailQuery(address, {
    skip: !address,
    // reconcile only — the candle tape streams from chain events
    pollingInterval: tabVisible ? 10_000 : 0,
  });
  const [recordTrade] = useRecordTradeMutation();
  // holders/trades columns scroll forever (paginated + merged per token)
  const [holdersOffset, setHoldersOffset] = useState(0);
  // creator revenue share (router fees) — claimable any time
  const [creatorFees, setCreatorFees] = useState<{ claimable: number; lifetime: number } | null>(null);
  // live price straight from the chain-event tape — beats the 10s poll
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [tradesOffset, setTradesOffset] = useState(0);
  const { data: holdersPage, isFetching: loadingHolders } = useGetTokenHoldersPageQuery(
    { address, offset: holdersOffset },
    { skip: !address }
  );
  const { data: tradesPage, isFetching: loadingTrades } = useGetTokenTradesPageQuery(
    { address, offset: tradesOffset },
    { skip: !address }
  );
  const holdersEndRef = useRef<HTMLDivElement>(null);
  const tradesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const watch = (el: HTMLDivElement | null, next: number | null | undefined, bump: (n: number) => void, busyNow: boolean) => {
      if (!el) return () => {};
      const io = new IntersectionObserver((es) => {
        if (es[0].isIntersecting && next && !busyNow) bump(next);
      }, { rootMargin: '400px' });
      io.observe(el);
      return () => io.disconnect();
    };
    const a = watch(holdersEndRef.current, holdersPage?.nextOffset, setHoldersOffset, loadingHolders);
    const b = watch(tradesEndRef.current, tradesPage?.nextOffset, setTradesOffset, loadingTrades);
    return () => { a(); b(); };
  }, [holdersPage?.nextOffset, tradesPage?.nextOffset, loadingHolders, loadingTrades]);
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
    if (t.tokenAddress && data?.uniswapPair && provider)
      creatorFeesOf(t.tokenAddress, provider as any).then(setCreatorFees).catch(() => {});
  };

  const buy = async () => {
    if (!signer) { toast.info('Connect your wallet'); return; }
    const onPool = !!data?.uniswapPair;
    if (data?.complete && !onPool) { toast.info('Sold out — graduation pending, trigger it below'); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    // pre-flight: raw wallet reverts read as 'Internal JSON-RPC error'
    const bal = await (signer as any).getBalance();
    if (bal.lt(utils.parseEther(toDecimalString(amt)))) {
      toast.error(`Not enough ETH — you need ${amt}, you have ${(+utils.formatEther(bal)).toFixed(5)}`);
      return;
    }
    setBusy(true);
    const toastId = toast.loading(`Buying $${t.symbol}…`);
    try {
      const txHash = onPool
        ? await buyOnPool(t.tokenAddress, amt, signer as any)
        : await buyToken(t.tokenAddress, amt, signer as any);
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
      const txHash = data?.uniswapPair
        ? await sellOnPool(t.tokenAddress, amt, signer as any)
        : await sellToken(t.tokenAddress, amt, signer as any);
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

        {t.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className='token-page__banner' src={t.bannerUrl} alt='' />
        )}
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
            {data?.uniswapPair && (
              <button
                className='token-page__ca'
                title='The Uniswap v2 pool — copy address'
                onClick={() => {
                  navigator.clipboard.writeText(data.uniswapPair!);
                  toast.success('Pool address copied');
                }}
              >
                🎓 pool {data.uniswapPair.slice(0, 6)}…{data.uniswapPair.slice(-4)} ⧉
              </button>
            )}
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

        {/* creator revenue share — visible to the creator once graduated */}
        {isCreator && data?.uniswapPair && creatorFees && (
          <div className='token-page__claim'>
            <span>
              Creator fees: <b>{creatorFees.claimable.toFixed(6)} ETH</b>
              <em> · lifetime {creatorFees.lifetime.toFixed(6)} ETH</em>
            </span>
            <button
              disabled={busy || creatorFees.claimable <= 0}
              onClick={async () => {
                if (!signer) { toast.info('Connect your wallet'); return; }
                setBusy(true);
                const ct = toast.loading('Claiming your creator fees…');
                try {
                  await claimCreatorFees(t.tokenAddress, signer as any);
                  toast.update(ct, { render: `Claimed ${creatorFees.claimable.toFixed(6)} ETH 💰`, type: 'success', isLoading: false, autoClose: 6000 });
                  refreshBalance();
                } catch (e: any) {
                  toast.update(ct, { render: `Claim failed — ${humanWalletError(e)}`, type: 'error', isLoading: false, autoClose: 7000 });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {creatorFees.claimable > 0 ? 'Claim' : 'Nothing yet'}
            </button>
          </div>
        )}

        {/* pump.fun-style market header: big mcap + 24h change + ATH bar */}
        {(() => {
          const ethUsd = data?.ethUsd || 0;
          const priceNow = livePrice ?? data?.priceEth ?? 0;
          const mcap = priceNow * 1000 * ethUsd;
          const mcapAgo = (data?.price24hAgoEth || 0) * 1000 * ethUsd;
          const diff = mcap - mcapAgo;
          const pct = mcapAgo > 0 ? (diff / mcapAgo) * 100 : 0;
          // ATH holds the peak; the fill tracks the LIVE price so dumps show
          // instantly (the bar recedes from the record)
          const ath = Math.max((data?.athPriceEth || 0) * 1000 * ethUsd, mcap);
          const fmtUsd = (v: number) =>
            v >= 1e6
              ? `$${(v / 1e6).toFixed(2)}M`
              : v >= 1e4
              ? `$${(v / 1e3).toFixed(2)}K`
              : `$${Math.round(v).toLocaleString()}`;
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
                  <span className='token-page__ath-label'>
                    ATH <b>{fmtUsd(ath)}</b>
                    {ath > 0 && mcap < ath && (
                      <em className='token-page__ath-dip'>
                        −{(100 - (mcap / ath) * 100).toFixed(1)}%
                      </em>
                    )}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        <div className='token-page__stats'>
          <div><span>Price</span><b>{(livePrice ?? data?.priceEth) ? (livePrice ?? data!.priceEth).toPrecision(3) : '0'} <em>ETH/1M</em></b></div>
          <div><span>Holders</span><b>{data?.holderCount ?? 0}</b></div>
          <div><span>Trades</span><b>{data?.tradeCount ?? 0}</b></div>
          <div
            title={
              data?.complete
                ? 'Graduated: the curve sold out. Its ETH + reserve tokens seeded a Uniswap pool and the LP was BURNED — liquidity is locked forever; nobody can pull it.'
                : `On curve: ${data?.bondingProgressPct ?? 0}% of 793.1M sold. The FINAL BUY auto-graduates the token — its collected ETH and reserve tokens are deposited into a Uniswap pool in the same transaction and the LP is BURNED (liquidity locked forever). Trading moves to the open market.`
            }
          >
            <span>Status</span>
            <b>{data?.complete ? 'Graduated' : 'On curve'}</b>
          </div>
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
          pairAddress={data?.uniswapPair || null}
          onPrice={setLivePrice}
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
              ? data?.uniswapPair
                ? 'Graduated — trading continues right here through the Uniswap pool. Fees follow pump.fun’s exact tiers: the creator earns up to 0.95% per trade, gliding to 0.05% as market cap grows.'
                : 'Sold out! Graduation is automatic on the final buy — if this token predates auto-migration, trigger it below.'
              : 'Price climbs as the curve fills, so buying early locks in the lowest price. Once it sells out, the token graduates automatically to a Uniswap pool.'}
          </p>
          {data?.complete && !data?.uniswapPair && (
            <button
              className='token-trade__cta'
              data-side='buy'
              disabled={busy}
              onClick={async () => {
                if (!signer) { toast.info('Connect your wallet'); return; }
                setBusy(true);
                const gt = toast.loading('Migrating liquidity to Uniswap…');
                try {
                  await graduateToken(t.tokenAddress, signer as any);
                  toast.update(gt, { render: '🎓 Graduated — the Uniswap pool is live', type: 'success', isLoading: false, autoClose: 6000 });
                  refetch();
                } catch (e: any) {
                  toast.update(gt, { render: `Graduation failed — ${humanWalletError(e)}`, type: 'error', isLoading: false, autoClose: 7000 });
                } finally {
                  setBusy(false);
                }
              }}
            >
              🎓 Graduate to Uniswap
            </button>
          )}
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
            disabled={busy || (side === 'buy' && data?.complete && !data?.uniswapPair)}
            onClick={() => {
              if (!signer) { toast.info('Connect your wallet to trade'); return; }
              if (side === 'buy') buy();
              else sell();
            }}
          >
            {!signer
              ? 'Connect wallet to trade'
              : side === 'buy'
              ? data?.complete && !data?.uniswapPair
                ? 'Graduated — migration pending'
                : data?.uniswapPair
                ? `Buy $${t.symbol} on the pool`
                : `Buy $${t.symbol}`
              : data?.uniswapPair
              ? `Sell $${t.symbol} on the pool`
              : `Sell $${t.symbol}`}
          </button>
        </div>

        <div className='token-page__cols'>
          <div className='token-page__col'>
            <h4>Holders</h4>
            {(holdersPage?.holders || data?.holders || []).length ? (
              (holdersPage?.holders || data?.holders || []).map((h, i) => (
                <div key={h.user.address} className='token-page__row' onClick={() => router.push(`/social/${h.user.address}`)}>
                  <span className='token-page__rank'>{i + 1}</span>
                  <span className='token-page__row-avatar'>
                    <PfpImage src={h.user.profilePicture} />
                  </span>
                  <span className='token-page__holder-id'>
                    <span className='token-page__holder'>
                      {h.user.username ? transformTitle(h.user.username) : shortenAddress(h.user.address)}
                      {h.user.verified && <VerifiedBadge size={11} />}
                    </span>
                  </span>
                  <span className='token-page__bal'>
                    {fmt(h.balance)}
                    <small className='token-page__bal-pct'>
                      {((h.balance / 1e9) * 100).toFixed(2)}%
                    </small>
                  </span>
                </div>
              ))
            ) : (
              <p className='social__empty'>No holders yet.</p>
            )}
            <div ref={holdersEndRef} />
            {loadingHolders && holdersOffset > 0 && <LoaderDots />}
          </div>
          <div className='token-page__col'>
            <h4>Trades</h4>
            {(tradesPage?.trades || data?.trades || []).length ? (
              (tradesPage?.trades || data?.trades || []).map((tr, i) => (
                <div key={i} className='token-page__row' onClick={() => router.push(`/social/${tr.trader}`)}>
                  <span className={`token-page__side token-page__side--${tr.side}`}>{tr.side}</span>
                  <span className='token-page__row-avatar'>
                    <PfpImage src={tr.user?.profilePicture} />
                  </span>
                  <span className='token-page__holder-id'>
                    <span className='token-page__holder'>
                      {tr.user?.username ? transformTitle(tr.user.username) : shortenAddress(tr.trader)}
                      {tr.user?.verified && <VerifiedBadge size={11} />}
                    </span>
                  </span>
                  <span className='token-page__bal'>{tr.ethAmount.toPrecision(2)} ETH</span>
                  <span className='token-page__ago'>{timeAgo(tr.createdAt)}</span>
                </div>
              ))
            ) : (
              <p className='social__empty'>No trades yet.</p>
            )}
            <div ref={tradesEndRef} />
            {loadingTrades && tradesOffset > 0 && <LoaderDots />}
          </div>
        </div>
      </div>
    </SocialShell>
  );
}
