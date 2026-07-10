import { useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import {
  ArtworkSaleType,
  NewDropArtwork,
  useCreateDropWithUploadsMutation,
} from '@/store/dropsReducer';
import { useGetUserDisplayInfoQuery } from '@/store/usersReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import shortenAddress from '@/utilities/shortenAddress';
import LoaderSpinner from '../LoaderSpinner';

const ACCEPTED_MEDIA = 'image/png,image/jpeg,image/gif,image/svg+xml,video/mp4';

interface ArtworkRow extends NewDropArtwork {
  key: number;
  previewUrl: string;
}

export default function CreateDropPanel() {
  const { walletAddress, signer } = useSAGEAccount();
  const [createDrop, { isLoading: isCreating }] = useCreateDropWithUploadsMutation();
  const [artistWallet, setArtistWallet] = useState('');
  const [artistDisplayName, setArtistDisplayName] = useState('');
  const [artistIconFile, setArtistIconFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [artworks, setArtworks] = useState<ArtworkRow[]>([]);
  const [durationHours, setDurationHours] = useState(24);
  const [approveNow, setApproveNow] = useState(true);
  const [goLiveAtInput, setGoLiveAtInput] = useState(''); // datetime-local; empty = immediately
  const [saleStartAtInput, setSaleStartAtInput] = useState(''); // datetime-local; empty = same as go-live
  const [nextKey, setNextKey] = useState(0);

  const bannerPreview = useMemo(
    () => (bannerFile ? URL.createObjectURL(bannerFile) : null),
    [bannerFile]
  );
  const artistIconPreview = useMemo(
    () => (artistIconFile ? URL.createObjectURL(artistIconFile) : null),
    [artistIconFile]
  );

  // Resolve and display the artist behind the target wallet, so the admin can
  // see who a drop is being created for before submitting.
  const effectiveArtistWallet = artistWallet.trim() || (walletAddress as string) || '';
  const isValidArtistWallet = /^0x[a-fA-F0-9]{40}$/.test(effectiveArtistWallet);
  const { data: artistInfo, isFetching: isResolvingArtist } = useGetUserDisplayInfoQuery(
    effectiveArtistWallet,
    { skip: !isValidArtistWallet }
  );
  const artistDisplay = !isValidArtistWallet
    ? null
    : isResolvingArtist
    ? 'looking up artist…'
    : artistInfo?.username
    ? `artist: ${artistInfo.username} (${shortenAddress(effectiveArtistWallet)})`
    : `no profile yet — ${shortenAddress(effectiveArtistWallet)} will be registered as a new artist`;

  function handleArtworkFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const rows = files.map((file, i) => ({
      key: nextKey + i,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      file,
      name: file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '),
      description: '',
      saleType: 'auction' as ArtworkSaleType,
      minPrice: 1,
      ticketCostTokens: 1,
      ticketCostPoints: 0,
      maxTickets: 100,
      maxTicketsPerUser: 5,
      costTokens: 1,
      costPoints: 0,
      maxPerUser: 10,
    }));
    setNextKey(nextKey + files.length);
    setArtworks((prev) => [...prev, ...rows]);
    e.target.value = '';
  }

  function updateArtwork(key: number, patch: Partial<ArtworkRow>) {
    setArtworks((prev) => prev.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  }

  function removeArtwork(key: number) {
    setArtworks((prev) => prev.filter((a) => a.key !== key));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bannerFile) {
      toast.warn('Select a banner image.');
      return;
    }
    if (artworks.length === 0) {
      toast.warn('Add at least one artwork.');
      return;
    }
    let goLiveAt: number | null = null;
    if (goLiveAtInput) {
      goLiveAt = Math.floor(new Date(goLiveAtInput).getTime() / 1000);
      if (goLiveAt <= Math.floor(Date.now() / 1000)) {
        toast.warn('Go-live time must be in the future.');
        return;
      }
    }
    let saleStartAt: number | null = null;
    if (saleStartAtInput) {
      saleStartAt = Math.floor(new Date(saleStartAtInput).getTime() / 1000);
      if (saleStartAt <= Math.floor(Date.now() / 1000)) {
        toast.warn('Sale start time must be in the future.');
        return;
      }
    }
    const result = await createDrop({
      artistWallet: artistWallet.trim() || (walletAddress as string),
      artistDisplayName: artistDisplayName.trim() || undefined,
      artistIconFile,
      name,
      description,
      bannerFile,
      artworks,
      durationHours,
      approveNow,
      goLiveAt,
      saleStartAt,
      // on-chain deploy needs a signer; if approving without one connected,
      // the mutation falls back to a DB-only approval (still stays hidden
      // from the storefront's contract-address checks until deployed).
      signer: approveNow ? (signer as any) : undefined,
    });
    if ('data' in result && result.data) {
      setName('');
      setDescription('');
      setBannerFile(null);
      setArtworks([]);
      setGoLiveAtInput('');
      setSaleStartAtInput('');
      setArtistDisplayName('');
      setArtistIconFile(null);
    }
  }

  return (
    <form className='create-drop-panel' onSubmit={handleSubmit}>
      <fieldset disabled={isCreating} className='create-drop-panel__fieldset'>
        <label className='create-drop-panel__label'>
          artist wallet (defaults to you)
          <input
            className='create-drop-panel__input'
            type='text'
            placeholder={String(walletAddress || '0x…')}
            value={artistWallet}
            onChange={(e) => setArtistWallet(e.target.value)}
            pattern='0x[a-fA-F0-9]{40}'
            title='0x-prefixed 40-hex-character wallet address'
          />
          {artistDisplay && (
            <em className='create-drop-panel__section-hint'>{artistDisplay}</em>
          )}
        </label>
        <label className='create-drop-panel__label'>
          artist display name for this drop (optional)
          <input
            className='create-drop-panel__input'
            type='text'
            placeholder={artistInfo?.username || 'e.g. your artist name'}
            maxLength={40}
            value={artistDisplayName}
            onChange={(e) => setArtistDisplayName(e.target.value)}
          />
          <em className='create-drop-panel__section-hint'>
            Only shown on this drop — doesn&apos;t rename the wallet&apos;s profile and won&apos;t
            carry over to other drops. Leave blank to show the artist&apos;s current profile name.
          </em>
        </label>
        <div className='create-drop-panel__label'>
          artist icon (optional)
          <div className='create-drop-panel__artist-icon-row'>
            <label className='create-drop-panel__artist-icon-uploader'>
              {artistIconPreview ? (
                <img
                  className='create-drop-panel__artist-icon-preview'
                  src={artistIconPreview}
                  alt='artist icon preview'
                />
              ) : (
                <span className='create-drop-panel__artist-icon-placeholder'>+</span>
              )}
              <input
                type='file'
                style={{ display: 'none' }}
                accept='image/png,image/jpeg,image/gif'
                onChange={(e) => setArtistIconFile(e.target.files?.[0] || null)}
              />
            </label>
            <em className='create-drop-panel__section-hint'>
              Becomes the artist&apos;s profile icon, shown next to their name on drops and the
              storefront instead of the default SAGE icon. Leave empty to keep their current one.
            </em>
            {artistIconFile && (
              <button
                type='button'
                className='create-drop-panel__remove-button'
                onClick={() => setArtistIconFile(null)}
              >
                ✕
              </button>
            )}
          </div>
        </div>
        <label className='create-drop-panel__label'>
          drop name *
          <input
            className='create-drop-panel__input'
            type='text'
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className='create-drop-panel__label'>
          description
          <textarea
            className='create-drop-panel__input create-drop-panel__textarea'
            value={description}
            maxLength={800}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className='create-drop-panel__banner-section'>
          <span className='create-drop-panel__section-title'>drop banner *</span>
          <p className='create-drop-panel__section-hint'>
            The cover image for the drop — not sold as an artwork.
          </p>
          <label className='create-drop-panel__banner-uploader'>
            {bannerPreview ? (
              <img className='create-drop-panel__banner-preview' src={bannerPreview} alt='banner preview' />
            ) : (
              <span className='create-drop-panel__banner-placeholder'>+ SELECT BANNER IMAGE</span>
            )}
            <input
              type='file'
              style={{ display: 'none' }}
              accept='image/png,image/jpeg,image/gif'
              onChange={(e) => setBannerFile(e.target.files?.[0] || null)}
            />
          </label>
          {bannerFile && <em className='create-drop-panel__section-hint'>{bannerFile.name}</em>}
        </div>

        <div className='create-drop-panel__artworks-header'>
          <span className='create-drop-panel__section-title'>artwork for sale *</span>
          <label className='create-drop-panel__add-button'>
            + ADD FILES
            <input
              type='file'
              multiple
              accept={ACCEPTED_MEDIA}
              style={{ display: 'none' }}
              onChange={handleArtworkFilesSelected}
            />
          </label>
        </div>
        {artworks.map((artwork) => (
          <div key={artwork.key} className='create-drop-panel__artwork-card'>
            <div className='create-drop-panel__artwork-row'>
              {artwork.previewUrl ? (
                <img
                  className='create-drop-panel__artwork-thumb'
                  src={artwork.previewUrl}
                  alt={artwork.name}
                />
              ) : (
                <span className='create-drop-panel__artwork-thumb create-drop-panel__artwork-thumb--video'>▶</span>
              )}
              <span className='create-drop-panel__artwork-filename'>{artwork.file.name}</span>
              <input
                className='create-drop-panel__input'
                type='text'
                required
                placeholder='artwork name'
                value={artwork.name}
                onChange={(e) => updateArtwork(artwork.key, { name: e.target.value })}
              />
              <select
                className='create-drop-panel__input'
                value={artwork.saleType}
                onChange={(e) =>
                  updateArtwork(artwork.key, { saleType: e.target.value as ArtworkSaleType })
                }
              >
                <option value='auction'>Auction</option>
                <option value='lottery'>Lottery</option>
                <option value='openEdition'>Open Edition</option>
              </select>
              <button
                type='button'
                className='create-drop-panel__remove-button'
                onClick={() => removeArtwork(artwork.key)}
              >
                ✕
              </button>
            </div>
            <textarea
              className='create-drop-panel__input create-drop-panel__textarea'
              placeholder='artwork description (optional)'
              maxLength={800}
              value={artwork.description}
              onChange={(e) => updateArtwork(artwork.key, { description: e.target.value })}
            />
            <div className='create-drop-panel__sale-params'>
              {artwork.saleType === 'auction' && (
                <label className='create-drop-panel__param'>
                  min bid (SAGE)
                  <input
                    className='create-drop-panel__input'
                    type='number'
                    min='0'
                    step='any'
                    required
                    value={artwork.minPrice}
                    onChange={(e) =>
                      updateArtwork(artwork.key, { minPrice: Number(e.target.value) })
                    }
                  />
                </label>
              )}
              {artwork.saleType === 'lottery' && (
                <>
                  <label className='create-drop-panel__param'>
                    ticket (SAGE)
                    <input
                      className='create-drop-panel__input'
                      type='number'
                      min='0'
                      step='any'
                      value={artwork.ticketCostTokens}
                      onChange={(e) =>
                        updateArtwork(artwork.key, { ticketCostTokens: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className='create-drop-panel__param'>
                    ticket (pixels)
                    <input
                      className='create-drop-panel__input'
                      type='number'
                      min='0'
                      value={artwork.ticketCostPoints}
                      onChange={(e) =>
                        updateArtwork(artwork.key, { ticketCostPoints: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className='create-drop-panel__param'>
                    max tickets
                    <input
                      className='create-drop-panel__input'
                      type='number'
                      min='1'
                      required
                      value={artwork.maxTickets}
                      onChange={(e) =>
                        updateArtwork(artwork.key, { maxTickets: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className='create-drop-panel__param'>
                    per user
                    <input
                      className='create-drop-panel__input'
                      type='number'
                      min='1'
                      required
                      value={artwork.maxTicketsPerUser}
                      onChange={(e) =>
                        updateArtwork(artwork.key, { maxTicketsPerUser: Number(e.target.value) })
                      }
                    />
                  </label>
                </>
              )}
              {artwork.saleType === 'openEdition' && (
                <>
                  <label className='create-drop-panel__param'>
                    mint (SAGE)
                    <input
                      className='create-drop-panel__input'
                      type='number'
                      min='0'
                      step='any'
                      value={artwork.costTokens}
                      onChange={(e) =>
                        updateArtwork(artwork.key, { costTokens: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className='create-drop-panel__param'>
                    mint (pixels)
                    <input
                      className='create-drop-panel__input'
                      type='number'
                      min='0'
                      value={artwork.costPoints}
                      onChange={(e) =>
                        updateArtwork(artwork.key, { costPoints: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className='create-drop-panel__param'>
                    mints per user (0 = ∞)
                    <input
                      className='create-drop-panel__input'
                      type='number'
                      min='0'
                      value={artwork.maxPerUser}
                      onChange={(e) =>
                        updateArtwork(artwork.key, { maxPerUser: Number(e.target.value) })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        ))}

        <div className='create-drop-panel__options'>
          <label className='create-drop-panel__label'>
            auction duration
            <select
              className='create-drop-panel__input'
              value={durationHours}
              onChange={(e) => setDurationHours(Number(e.target.value))}
            >
              <option value={1}>1 hour</option>
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
            </select>
          </label>
          <label className='create-drop-panel__label'>
            go live at (empty = immediately)
            <input
              className='create-drop-panel__input'
              type='datetime-local'
              value={goLiveAtInput}
              onChange={(e) => setGoLiveAtInput(e.target.value)}
            />
          </label>
          <label className='create-drop-panel__label'>
            sale/mint starts at (empty = same as go live, or now)
            <input
              className='create-drop-panel__input'
              type='datetime-local'
              value={saleStartAtInput}
              onChange={(e) => setSaleStartAtInput(e.target.value)}
            />
          </label>
          <label className='create-drop-panel__checkbox-label'>
            <input
              type='checkbox'
              checked={approveNow}
              onChange={(e) => setApproveNow(e.target.checked)}
            />
            approve now — deploys on-chain (will prompt wallet signatures)
          </label>
        </div>

        <button type='submit' className='create-drop-panel__submit-button'>
          {isCreating ? <LoaderSpinner /> : 'CREATE DROP'}
        </button>
        {isCreating && (
          <p className='create-drop-panel__uploading-note'>
            Uploading media to Arweave — keep this tab open…
          </p>
        )}
      </fieldset>
    </form>
  );
}
