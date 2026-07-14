import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { useSigner, useProvider } from 'wagmi';
import { createEdition, createCollection, mintEdition, editionMinted } from '@/utilities/socialToken';
import { baseApi } from '@/store/baseReducer';
import { useCreatePostMutation, useToggleHideItemMutation } from '@/store/socialReducer';
import VerificationModal from './VerificationModal';
import useSAGEAccount from '@/hooks/useSAGEAccount';

interface EditionRow {
  id: number;
  editionAddress: string;
  name: string;
  symbol: string;
  imageUrl: string;
  priceEth: number;
  maxSupply: number;
  halted: boolean;
}

const editionApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    getProfileEditions: builder.query<{ launcher: string | null; editions: EditionRow[] }, string>({
      query: (address) => ({ url: `social?action=GetProfileEditions&address=${address}` }),
      providesTags: (_r, _e, address) => [{ type: 'SocialProfile', id: `ed-${address}` }],
    }),
    haltEdition: builder.mutation<{ ok: boolean; halted: boolean }, { editionAddress: string; halt: boolean }>({
      query: (body) => ({ url: 'social?action=HaltEdition', method: 'POST', body }),
      invalidatesTags: ['SocialProfile'],
    }),
    recordEditionLaunch: builder.mutation<
      { ok: boolean; id: number },
      {
        editionAddress: string;
        name: string;
        symbol: string;
        imageUrl: string;
        priceEth: number;
        maxSupply: number;
        launchTxHash: string;
      }
    >({
      query: (body) => ({ url: 'social?action=RecordEditionLaunch', method: 'POST', body }),
      invalidatesTags: ['SocialProfile'],
    }),
  }),
});
const { useGetProfileEditionsQuery, useRecordEditionLaunchMutation, useHaltEditionMutation } = editionApi;

/** Post-launch share sheet — Twitter intent + copy link. */
function ShareLaunch({ symbol, name, artist, onClose }: { symbol: string; name: string; artist: string; onClose: () => void }) {
  const [createPost] = useCreatePostMutation();
  // link to the ARTIST's profile — that's where the mint panel renders (the
  // edition contract address is not a routable page)
  const url = typeof window !== 'undefined' ? `${window.location.origin}/social/${artist}` : '';
  const line = `I just launched ${name} ($${symbol}) on SAGE Social 🎨 mint it:`;
  const toFeed = async () => {
    try { await createPost({ text: `${line}\n${url}` }).unwrap(); toast.success('Shared to your feed 🎉'); onClose(); }
    catch (e: any) { toast.error(e?.data?.error || 'Could not share'); }
  };
  const toX = () => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(line + '\n' + url)}`, '_blank');
  return (
    <div className='social-verify__overlay' onClick={onClose}>
      <div className='social-verify social-verify--launch' onClick={(e) => e.stopPropagation()}>
        <div className='social-verify__head'>
          <h3>🎉 ${symbol} is live</h3>
          <button className='social-verify__close' onClick={onClose}>✕</button>
        </div>
        <p className='social-verify__blurb'>Share it so your followers can mint.</p>
        <button className='social-verify__buy' onClick={toFeed}>Post to my feed</button>
        <button className='social-verify__buy social-verify__buy--eth' onClick={toX}>Share on 𝕏</button>
        <button className='social-refer__btn' style={{ marginTop: 8, width: '100%' }}
          onClick={() => { navigator.clipboard.writeText(url); toast.success('Link copied'); }}>Copy mint link</button>
      </div>
    </div>
  );
}

/** Launch modal: single edition (one artwork) OR a ZIP collection (per-token art). */
function LaunchEditionModal({ onClose }: { onClose: () => void }) {
  const { data: signer } = useSigner();
  const { walletAddress, userData } = useSAGEAccount();
  const artistAddress = walletAddress || (userData as any)?.walletAddress || '';
  const [record] = useRecordEditionLaunchMutation();
  const [mode, setMode] = useState<'edition' | 'collection'>('edition');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [supply, setSupply] = useState('100');
  const [price, setPrice] = useState('0.01');
  const [imageUrl, setImageUrl] = useState('');
  const [zip, setZip] = useState<{ baseUri: string; count: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [needVerify, setNeedVerify] = useState(false);
  const [live, setLive] = useState<{ symbol: string; name: string; artist: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  const onFile = async (file?: File) => {
    if (!file) return;
    const t = toast.loading('Uploading art…');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/social-upload/', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'upload failed');
      setImageUrl(data.url);
      toast.update(t, { render: 'Art ready', type: 'success', isLoading: false, autoClose: 2000 });
    } catch (e: any) {
      toast.update(t, { render: e?.message?.slice(0, 80) || 'Upload failed', type: 'error', isLoading: false, autoClose: 4000 });
    }
  };

  const onZip = async (file?: File) => {
    if (!file) return;
    const t = toast.loading('Processing ZIP — compressing + pinning to Filebase…');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/social-collection/?name=${encodeURIComponent(name || 'Collection')}`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'zip failed');
      setZip({ baseUri: data.baseUri, count: data.count, name: data.name });
      setSupply(String(data.count));
      toast.update(t, { render: `${data.count} pieces pinned ✓`, type: 'success', isLoading: false, autoClose: 3000 });
    } catch (e: any) {
      toast.update(t, { render: e?.message?.slice(0, 100) || 'ZIP failed', type: 'error', isLoading: false, autoClose: 6000 });
    }
  };

  const go = async () => {
    if (!signer) { toast.info('Connect your wallet'); return; }
    if (!name.trim() || !symbol.trim()) { toast.error('Name and ticker required'); return; }
    const p = Number(price);
    if (isNaN(p) || p < 0) { toast.error('Check the price'); return; }
    setBusy(true);
    const t = toast.loading('Deploying… (free — gas only)');
    try {
      let edition: string, txHash: string, max: number;
      if (mode === 'collection') {
        if (!zip) { toast.update(t, { render: 'Upload a ZIP first', type: 'error', isLoading: false, autoClose: 4000 }); setBusy(false); return; }
        max = zip.count;
        ({ edition, txHash } = await createCollection(name.trim(), symbol.trim().toUpperCase(), zip.baseUri, max, p, signer as any));
        await record({ editionAddress: edition, name: name.trim(), symbol: symbol.trim().toUpperCase(), imageUrl: zip.baseUri, priceEth: p, maxSupply: max, launchTxHash: txHash }).unwrap();
      } else {
        if (!imageUrl) { toast.update(t, { render: 'Upload artwork first', type: 'error', isLoading: false, autoClose: 4000 }); setBusy(false); return; }
        max = Number(supply);
        if (!max || max < 1) { toast.update(t, { render: 'Check supply', type: 'error', isLoading: false, autoClose: 4000 }); setBusy(false); return; }
        ({ edition, txHash } = await createEdition(name.trim(), symbol.trim().toUpperCase(), imageUrl, max, p, signer as any));
        await record({ editionAddress: edition, name: name.trim(), symbol: symbol.trim().toUpperCase(), imageUrl, priceEth: p, maxSupply: max, launchTxHash: txHash }).unwrap();
      }
      toast.update(t, { render: `${name} is live 🎨`, type: 'success', isLoading: false, autoClose: 3000 });
      setLive({ symbol: symbol.trim().toUpperCase(), name: name.trim(), artist: artistAddress });
    } catch (err: any) {
      if (err?.data?.needsVerification) { setNeedVerify(true); toast.dismiss(t); }
      else toast.update(t, { render: err?.data?.error || err?.message?.slice(0, 90) || 'Launch failed', type: 'error', isLoading: false, autoClose: 6000 });
    } finally {
      setBusy(false);
    }
  };

  if (needVerify) return <VerificationModal onClose={onClose} />;
  if (live) return <ShareLaunch {...live} onClose={onClose} />;
  const artReady = mode === 'collection' ? !!zip : !!imageUrl;
  return (
    <div className='social-verify__overlay' onClick={onClose}>
      <div className='social-verify social-verify--launch' onClick={(e) => e.stopPropagation()}>
        <div className='social-verify__head'>
          <h3>🎨 Launch NFTs</h3>
          <button className='social-verify__close' onClick={onClose}>✕</button>
        </div>
        <div className='social__tabs' style={{ marginBottom: 12 }}>
          <button className={`social__tab ${mode === 'edition' ? 'social__tab--active' : ''}`} onClick={() => setMode('edition')}>Single edition</button>
          <button className={`social__tab ${mode === 'collection' ? 'social__tab--active' : ''}`} onClick={() => setMode('collection')}>ZIP collection</button>
        </div>
        <p className='social-verify__blurb'>
          {mode === 'edition'
            ? 'One artwork, many mints. Free to create; each mint pays 1% to the platform, 99% to you; minters pay gas.'
            : 'A ZIP of images → one token per image, each named after its file. Compressed + pinned to Filebase. 1% platform / 99% you.'}
        </p>
        <input className='social-search__input' placeholder='Name (e.g. Chartreuse Studies)' value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 8 }} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input className='social-search__input' placeholder='Ticker' value={symbol} maxLength={12} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          <div className='social-unit-input'>
            <input placeholder='Mint price' value={price} onChange={(e) => setPrice(e.target.value)} />
            <span>ETH</span>
          </div>
          {mode === 'edition' && (
            <input className='social-search__input' placeholder='Supply' value={supply} onChange={(e) => setSupply(e.target.value)} />
          )}
        </div>
        {mode === 'edition' ? (
          <>
            <input ref={fileRef} type='file' accept='image/jpeg,image/png,image/webp,image/gif' style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
            <button className='social-refer__btn' style={{ width: '100%', marginBottom: 12 }} onClick={() => fileRef.current?.click()}>
              {imageUrl ? '✓ Artwork uploaded — replace' : 'Upload artwork'}
            </button>
          </>
        ) : (
          <>
            <input ref={zipRef} type='file' accept='.zip,application/zip' style={{ display: 'none' }} onChange={(e) => onZip(e.target.files?.[0])} />
            <button className='social-refer__btn' style={{ width: '100%', marginBottom: 12 }} onClick={() => zipRef.current?.click()}>
              {zip ? `✓ ${zip.count} pieces pinned — replace ZIP` : 'Upload ZIP of images'}
            </button>
          </>
        )}
        <button className='social-verify__buy' disabled={busy || !artReady} onClick={go}>
          {busy ? 'Deploying…' : `Launch ${mode === 'collection' ? 'collection' : 'edition'} — free (gas only)`}
        </button>
      </div>
    </div>
  );
}

export default function EditionPanel({ address, isSelf }: { address: string; isSelf: boolean }) {
  const router = useRouter();
  const { data } = useGetProfileEditionsQuery(address, { skip: !address });
  const [haltEdition] = useHaltEditionMutation();
  const { data: signer } = useSigner();
  const provider = useProvider();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [hideItem] = useToggleHideItemMutation();

  useEffect(() => {
    (async () => {
      if (!data?.editions.length || !provider) return;
      const next: Record<string, number> = {};
      for (const e of data.editions.slice(0, 5)) {
        try {
          next[e.editionAddress] = await editionMinted(e.editionAddress, provider as any);
        } catch {}
      }
      setCounts(next);
    })();
  }, [data?.editions, provider]);

  if (!data?.launcher) return null;
  if (!data.editions.length && !isSelf) return null;

  const mint = async (e: EditionRow) => {
    if (!signer) { toast.info('Connect your wallet'); return; }
    setBusy(true);
    const t = toast.loading(`Minting ${e.name}…`);
    try {
      const tx = await mintEdition(e.editionAddress, e.priceEth, signer as any);
      toast.update(t, { render: `Minted ${e.name} 🎨 (${tx.slice(0, 10)}…)`, type: 'success', isLoading: false, autoClose: 5000 });
      if (provider) editionMinted(e.editionAddress, provider as any).then((n) => setCounts((c) => ({ ...c, [e.editionAddress]: n }))).catch(() => {});
    } catch (err: any) {
      toast.update(t, { render: err?.message?.slice(0, 80) || 'Mint failed', type: 'error', isLoading: false, autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='social-token'>
      <div className='social-token__head'>
        <span className='social-token__ticker'>🎨 Editions</span>
        {isSelf && (
          <button
            className='social-token__airdrop'
            style={{ marginLeft: 'auto' }}
            onClick={() => router.push('/social/launch/nft')}
          >
            Launch artwork
          </button>
        )}
      </div>
      {data.editions.map((e) => (
        <div key={e.editionAddress} className='social-edition'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={e.imageUrl} alt={e.name} />
          <div className='social-edition__meta'>
            <b>{e.name}</b>
            <span>
              {counts[e.editionAddress] ?? '–'}/{e.maxSupply} minted · {e.priceEth} ETH
            </span>
          </div>
          <button
            className='social-token__buy'
            disabled={busy || e.halted || (counts[e.editionAddress] ?? 0) >= e.maxSupply}
            onClick={() => mint(e)}
          >
            {(counts[e.editionAddress] ?? 0) >= e.maxSupply
              ? 'Sold out'
              : e.halted
              ? 'Mint closed'
              : 'Mint'}
          </button>
          {isSelf && (
            <>
              <button
                className='social-hide-link'
                onClick={async () => {
                  try {
                    const r = await haltEdition({ editionAddress: e.editionAddress, halt: !e.halted }).unwrap();
                    toast.success(r.halted ? 'Mint stopped' : 'Mint reopened');
                  } catch (err: any) { toast.error(err?.data?.error || 'Could not update'); }
                }}
              >
                {e.halted ? 'reopen mint' : 'stop mint'}
              </button>
              <button
                className='social-hide-link'
                onClick={async () => {
                  try {
                    await hideItem({ kind: 'edition', ref: e.editionAddress.toLowerCase(), hide: true }).unwrap();
                    toast.success('Edition hidden');
                  } catch { toast.error('Could not hide'); }
                }}
              >
                hide
              </button>
            </>
          )}
        </div>
      ))}
      {!data.editions.length && isSelf && (
        <p className='social-token__stat'>No editions yet — launch your first mint.</p>
      )}
      {open && <LaunchEditionModal onClose={() => setOpen(false)} />}
    </div>
  );
}
