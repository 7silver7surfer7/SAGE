import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useSigner, useProvider } from 'wagmi';
import { createEdition, mintEdition, editionMinted } from '@/utilities/socialToken';
import { baseApi } from '@/store/baseReducer';
import VerificationModal from './VerificationModal';

interface EditionRow {
  id: number;
  editionAddress: string;
  name: string;
  symbol: string;
  imageUrl: string;
  priceEth: number;
  maxSupply: number;
}

const editionApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    getProfileEditions: builder.query<{ launcher: string | null; editions: EditionRow[] }, string>({
      query: (address) => ({ url: `social?action=GetProfileEditions&address=${address}` }),
      providesTags: (_r, _e, address) => [{ type: 'SocialProfile', id: `ed-${address}` }],
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
const { useGetProfileEditionsQuery, useRecordEditionLaunchMutation } = editionApi;

/** Launch modal: name/symbol/supply/price + artwork upload (compressed server-side). */
function LaunchEditionModal({ onClose }: { onClose: () => void }) {
  const { data: signer } = useSigner();
  const [record] = useRecordEditionLaunchMutation();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [supply, setSupply] = useState('100');
  const [price, setPrice] = useState('0.01');
  const [imageUrl, setImageUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [needVerify, setNeedVerify] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file?: File) => {
    if (!file) return;
    const t = toast.loading('Uploading edition art…');
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

  const go = async () => {
    if (!signer) { toast.info('Connect your wallet'); return; }
    if (!name.trim() || !symbol.trim() || !imageUrl) { toast.error('Name, ticker and artwork required'); return; }
    const max = Number(supply);
    const p = Number(price);
    if (!max || max < 1 || isNaN(p) || p < 0) { toast.error('Check supply and price'); return; }
    setBusy(true);
    const t = toast.loading('Deploying your edition… (free — gas only)');
    try {
      // metadata URI is assigned post-registration; use a placeholder bound later
      const { edition, txHash } = await createEdition(
        name.trim(), symbol.trim().toUpperCase(), imageUrl, max, p, signer as any
      );
      await record({
        editionAddress: edition, name: name.trim(), symbol: symbol.trim().toUpperCase(),
        imageUrl, priceEth: p, maxSupply: max, launchTxHash: txHash,
      }).unwrap();
      toast.update(t, { render: `${name} is live — ${max} mints at ${p} ETH 🎨`, type: 'success', isLoading: false, autoClose: 5000 });
      onClose();
    } catch (err: any) {
      if (err?.data?.needsVerification) { setNeedVerify(true); toast.dismiss(t); }
      else toast.update(t, { render: err?.data?.error || err?.message?.slice(0, 90) || 'Launch failed', type: 'error', isLoading: false, autoClose: 6000 });
    } finally {
      setBusy(false);
    }
  };

  if (needVerify) return <VerificationModal onClose={onClose} />;
  return (
    <div className='social-verify__overlay' onClick={onClose}>
      <div className='social-verify' onClick={(e) => e.stopPropagation()}>
        <div className='social-verify__head'>
          <h3>🎨 Launch an NFT edition</h3>
          <button className='social-verify__close' onClick={onClose}>✕</button>
        </div>
        <p className='social-verify__blurb'>
          A self-serve mint for your art or project. Creating is FREE (gas only) — every mint
          pays 1% to the platform, 99% straight to you. Minters pay their own gas.
        </p>
        <input className='social-search__input' placeholder='Edition name (e.g. Chartreuse Studies)' value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 10 }} />
        <input className='social-search__input' placeholder='Ticker (e.g. CHST)' value={symbol} maxLength={12} onChange={(e) => setSymbol(e.target.value.toUpperCase())} style={{ marginBottom: 10 }} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <input className='social-search__input' placeholder='Supply' value={supply} onChange={(e) => setSupply(e.target.value)} />
          <input className='social-search__input' placeholder='Price (ETH)' value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <input ref={fileRef} type='file' accept='image/jpeg,image/png,image/webp,image/gif' style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
        <button className='social-refer__btn' style={{ marginBottom: 14 }} onClick={() => fileRef.current?.click()}>
          {imageUrl ? '✓ Artwork uploaded — replace' : 'Upload artwork'}
        </button>
        <button className='social-verify__buy' disabled={busy} onClick={go}>
          {busy ? 'Deploying…' : 'Launch edition — free (gas only)'}
        </button>
      </div>
    </div>
  );
}

export default function EditionPanel({ address, isSelf }: { address: string; isSelf: boolean }) {
  const { data } = useGetProfileEditionsQuery(address, { skip: !address });
  const { data: signer } = useSigner();
  const provider = useProvider();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

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
          <button className='social-token__airdrop' style={{ marginLeft: 'auto' }} onClick={() => setOpen(true)}>
            Launch edition
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
            disabled={busy || (counts[e.editionAddress] ?? 0) >= e.maxSupply}
            onClick={() => mint(e)}
          >
            {(counts[e.editionAddress] ?? 0) >= e.maxSupply ? 'Sold out' : 'Mint'}
          </button>
        </div>
      ))}
      {!data.editions.length && isSelf && (
        <p className='social-token__stat'>No editions yet — launch your first mint.</p>
      )}
      {open && <LaunchEditionModal onClose={() => setOpen(false)} />}
    </div>
  );
}
