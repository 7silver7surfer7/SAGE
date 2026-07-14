import { useEffect, useRef, useState } from 'react';
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
  creatorFeesOf,
  claimCreatorFees,
} from '@/utilities/socialToken';
import VerificationModal from './VerificationModal';
import { useRecordTradeMutation } from '@/store/socialReducer';
import { humanWalletError } from '@/utilities/walletError';

/**
 * Launch modal — pump.fun-faithful form: name+ticker row, description,
 * social links, a big drag-and-drop art upload with the limits printed on
 * the module, and an optional wide banner for the coin page.
 */
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
  const [website, setWebsite] = useState('');
  const [linksOpen, setLinksOpen] = useState(false);
  // default OFF: no-dump launches are the norm — opting IN reserves the 2%
  const [withAirdrop, setWithAirdrop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needVerify, setNeedVerify] = useState(false);
  // coin art (square) + optional banner, uploaded up-front so the launch
  // record carries the S3 URLs (kind=avatar → 400² cover; kind=banner → 1500×500)
  const [imageUrl, setImageUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [uploading, setUploading] = useState<'' | 'art' | 'banner'>('');
  const [dragOver, setDragOver] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const filePick = useRef<HTMLInputElement>(null);
  const bannerPick = useRef<HTMLInputElement>(null);

  const upload = async (file: File | undefined, kind: 'art' | 'banner') => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast.error('Images only — jpg, png, webp or gif'); return; }
    if (file.size > 12 * 1024 * 1024) { toast.error('Images are capped at 12MB'); return; }
    setUploading(kind);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/social-upload/?kind=${kind === 'art' ? 'avatar' : 'banner'}`, {
        method: 'POST',
        body: form,
      });
      const d = await res.json();
      if (!res.ok || !d.url) throw new Error(d.error || 'upload failed');
      if (kind === 'art') setImageUrl(d.url);
      else setBannerUrl(d.url);
    } catch (err: any) {
      toast.error(err?.message || 'Image upload failed');
    } finally {
      setUploading('');
    }
  };

  const go = async () => {
    if (!signer) { toast.info('Connect your wallet'); return; }
    if (!name.trim() || !symbol.trim()) { toast.error('Name and ticker required'); return; }
    const buyEth = Number(initialBuy) || 0;
    if (buyEth < 0) { toast.error('Initial buy cannot be negative'); return; }
    setBusy(true);
    const t = toast.loading(buyEth > 0 ? `Launching + buying ${buyEth} ETH…` : 'Launching your coin… (free — you only pay gas)');
    try {
      const { token, txHash, devBuy } = await launchToken(name.trim(), symbol.trim().toUpperCase(), withAirdrop, signer as any, buyEth);
      await record({
        tokenAddress: token,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        launchTxHash: txHash,
        airdropEnabled: withAirdrop,
        description: description.trim() || undefined,
        website: website.trim() || undefined,
        imageUrl: imageUrl || undefined,
        bannerUrl: bannerUrl || undefined,
      }).unwrap();
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
      <div className='social-verify social-verify--launch social-launch-modal social-launch-modal--pump' onClick={(e) => e.stopPropagation()}>
        <div className='social-verify__head'>
          <h3>🚀 Launch your coin</h3>
          <button className='social-verify__close' onClick={onClose}>✕</button>
        </div>

        <div className='pump-form__row'>
          <div className='pump-form__field'>
            <label>Coin name</label>
            <input
              className='social-search__input'
              placeholder='Name your coin'
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className='pump-form__field'>
            <label>Ticker</label>
            <input
              className='social-search__input'
              placeholder='Add a coin ticker (e.g. DOGE)'
              value={symbol}
              maxLength={12}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            />
          </div>
        </div>

        <div className='pump-form__field'>
          <label>
            Description <span className='pump-form__optional'>(Optional)</span>
          </label>
          <textarea
            className='social-search__input'
            placeholder='Write a short description'
            value={description}
            maxLength={300}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <button className='pump-form__collapse' onClick={() => setLinksOpen((o) => !o)}>
          🔗 Add social links <span className='pump-form__optional'>(Optional)</span>{' '}
          <span className='pump-form__chev'>{linksOpen ? '▲' : '▼'}</span>
        </button>
        {linksOpen && (
          <div className='pump-form__field'>
            <input
              className='social-search__input'
              placeholder='Website — https://…'
              value={website}
              maxLength={120}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
        )}

        {/* pump.fun-style dropzone */}
        <input
          ref={filePick}
          type='file'
          accept='image/jpeg,image/png,image/webp,image/gif'
          hidden
          onChange={(e) => { upload(e.target.files?.[0], 'art'); e.target.value = ''; }}
        />
        <div
          className={`pump-drop ${dragOver ? 'pump-drop--over' : ''}`}
          onClick={() => filePick.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files?.[0], 'art'); }}
        >
          {imageUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className='pump-drop__preview' src={imageUrl} alt='coin art' />
              <span className='pump-drop__replace'>Click or drop to replace</span>
            </>
          ) : (
            <>
              <span className='pump-drop__icon'>🖼</span>
              <b>{uploading === 'art' ? 'Uploading…' : 'Select an image to upload'}</b>
              <span className='pump-drop__sub'>or drag and drop it here</span>
            </>
          )}
        </div>
        <div className='pump-drop__limits'>
          <div>
            <b>File size and type</b>
            <span>Image — max 12MB. .jpg, .png, .webp or .gif</span>
          </div>
          <div>
            <b>Resolution and aspect ratio</b>
            <span>1:1 square recommended — shown as a 400×400 badge</span>
          </div>
        </div>

        {/* optional wide banner for the coin page */}
        <input
          ref={bannerPick}
          type='file'
          accept='image/jpeg,image/png,image/webp,image/gif'
          hidden
          onChange={(e) => { upload(e.target.files?.[0], 'banner'); e.target.value = ''; }}
        />
        <button className='pump-form__collapse' onClick={() => setBannerOpen((o) => !o)}>
          🏞 Add banner <span className='pump-form__optional'>(Optional)</span>{' '}
          <span className='pump-form__chev'>{bannerOpen ? '▲' : '▼'}</span>
        </button>
        {bannerOpen && (
          <div
            className='pump-drop pump-drop--banner'
            onClick={() => bannerPick.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0], 'banner'); }}
          >
            {bannerUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className='pump-drop__preview pump-drop__preview--wide' src={bannerUrl} alt='banner' />
                <span className='pump-drop__replace'>Click or drop to replace</span>
              </>
            ) : (
              <>
                <b>{uploading === 'banner' ? 'Uploading…' : 'Select a banner image'}</b>
                <span className='pump-drop__sub'>3:1 wide — cropped to 1500×500, max 12MB</span>
              </>
            )}
          </div>
        )}

        <label className='social-edit__label' style={{ marginTop: 14 }}>
          Initial buy — makes you holder #1
        </label>
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
        <button className='social-verify__buy' disabled={busy || !!uploading} onClick={go}>
          {busy ? 'Launching…' : 'Launch — free (gas only)'}
        </button>
        <p className='social-verify__fine'>
          pump.fun&apos;s exact fee schedule: 1.25% on the curve (0.30% yours); post-graduation
          tiers stagger by market cap — your share peaks at 0.95% past $85k, gliding to 0.05%
          by $20M. Claimable any time. 1B supply, auto-graduates to Uniswap (LP burned).
        </p>
      </div>
    </div>
  );
}

interface Props {
  address: string;
  isSelf: boolean;
  followers: string[];
  // The "Launch your creator coin" empty-state CTA — only the dedicated
  // /social/launch/token page wants it. Embedded on a regular profile it's
  // redundant promotion: launching happens from the Tokens page, and once
  // live the creator posts about it themselves.
  showLaunchCta?: boolean;
}

export default function TokenPanel({ address, isSelf, showLaunchCta }: Props) {
  const router = useRouter();
  const { data } = useGetProfileTokenQuery(address, { skip: !address });
  const { data: signer } = useSigner();
  const provider = useProvider();
  const [recordAirdrop] = useRecordAirdropMutation();
  const [hideItem] = useToggleHideItemMutation();
  const [launchOpen, setLaunchOpen] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // post-graduation creator revenue share accrued in the router — claimable
  // right from the profile (mirrors the token page's claim chip)
  const [fees, setFees] = useState<{ claimable: number; lifetime: number } | null>(null);

  const token = data?.token;
  useEffect(() => {
    if (token?.tokenAddress && provider) {
      tokenSpotPriceEthPerMillion(token.tokenAddress, provider as any).then(setPrice).catch(() => {});
      // not-graduated tokens have no router accrual — the call reverts/zeroes
      if (isSelf)
        creatorFeesOf(token.tokenAddress, provider as any).then(setFees).catch(() => {});
    }
  }, [token?.tokenAddress, provider, isSelf]);

  // while the profile-token query is in flight, hold the space with a quiet
  // placeholder — returning null here left the page as a bare Layout gradient
  if (!data) {
    return <div className='social-token social-token--loading' aria-hidden />;
  }
  // launchpad disabled on this network (no factory) → render nothing
  if (!data.factory) return null;

  if (!token) {
    if (!isSelf || !showLaunchCta) return null;
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
        {token.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className='social-token__badge' src={token.imageUrl} alt={token.symbol} />
        )}
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
      {isSelf && fees && (fees.claimable > 0 || fees.lifetime > 0) && (
        <div className='social-token__fees'>
          <span>
            Creator fees: <b>{fees.claimable.toFixed(6)} ETH</b> claimable
            <small> · {fees.lifetime.toFixed(6)} lifetime</small>
          </span>
          <button
            className='social-token__airdrop'
            disabled={busy || fees.claimable <= 0}
            onClick={async () => {
              if (!signer) { toast.info('Connect your wallet'); return; }
              setBusy(true);
              const t = toast.loading('Claiming your creator fees…');
              try {
                await claimCreatorFees(token.tokenAddress, signer as any);
                toast.update(t, { render: `Claimed ${fees.claimable.toFixed(6)} ETH 💸`, type: 'success', isLoading: false, autoClose: 5000 });
                if (provider) creatorFeesOf(token.tokenAddress, provider as any).then(setFees).catch(() => {});
              } catch (err: any) {
                toast.update(t, { render: `Claim failed — ${humanWalletError(err)}`, type: 'error', isLoading: false, autoClose: 6000 });
              } finally {
                setBusy(false);
              }
            }}
          >
            💸 Claim
          </button>
        </div>
      )}
    </div>
  );
}
