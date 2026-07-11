import { useState } from 'react';
import Modal, { Props as ModalProps } from '@/components/Modals';
import { Drop_include_GamesAndArtist } from '@/prisma/types';
import {
  ArtworkSaleType,
  NewDropArtwork,
  useAddArtworksToDropMutation,
  useDeleteDraftArtworkMutation,
  useUpdateDraftArtworkMutation,
} from '@/store/dropsReducer';
import { toast } from 'react-toastify';
import LoaderSpinner from '../LoaderSpinner';
import { BaseMedia } from '../Media/BaseMedia';

interface EditDropModalProps extends ModalProps {
  drop: Drop_include_GamesAndArtist;
}

interface ExistingRow {
  gameType: 'auction' | 'lottery' | 'openEdition';
  gameId: number;
  name: string;
  description: string;
  mediaSrc: string;
  minPrice?: string;
  ticketCostTokens?: number;
  ticketCostPoints?: number;
  maxTickets?: number;
  maxTicketsPerUser?: number;
  costTokens?: number;
  costPoints?: number;
  maxPerUser?: number;
}

interface NewRow extends NewDropArtwork {
  key: number;
  previewUrl: string;
}

const ACCEPTED_MEDIA = 'image/png,image/jpeg,image/gif,image/svg+xml,video/mp4';

/**
 * Edit a SAVED DRAFT without deleting it: fix names/prices (free, DB-only —
 * never re-uploads what's already paid for on Arweave), remove an artwork,
 * or add NEW media files (only those cost AR). After editing, run "verify
 * assets" on the card and approve as usual. Live drops can't be edited —
 * their parameters are baked on-chain at deploy.
 */
export function EditDropModal({ isOpen, closeModal, drop }: EditDropModalProps) {
  const [updateArtwork, { isLoading: isUpdating }] = useUpdateDraftArtworkMutation();
  const [deleteArtwork, { isLoading: isDeleting }] = useDeleteDraftArtworkMutation();
  const [addArtworks, { isLoading: isAdding }] = useAddArtworksToDropMutation();

  const initialRows: ExistingRow[] = [
    ...drop.Auctions.map((a) => ({
      gameType: 'auction' as const,
      gameId: a.id,
      name: a.Nft?.name || '',
      description: a.Nft?.description || '',
      mediaSrc: a.Nft?.s3PathOptimized || '',
      minPrice: a.minimumPrice || '0',
    })),
    ...drop.Lotteries.map((l) => ({
      gameType: 'lottery' as const,
      gameId: l.id,
      name: l.Nfts[0]?.name || '',
      description: l.Nfts[0]?.description || '',
      mediaSrc: l.Nfts[0]?.s3PathOptimized || '',
      ticketCostTokens: l.costPerTicketTokens,
      ticketCostPoints: l.costPerTicketPoints,
      maxTickets: l.maxTickets,
      maxTicketsPerUser: l.maxTicketsPerUser,
    })),
    ...drop.OpenEditions.map((oe) => ({
      gameType: 'openEdition' as const,
      gameId: oe.id,
      name: oe.Nft?.name || '',
      description: oe.Nft?.description || '',
      mediaSrc: oe.Nft?.s3PathOptimized || '',
      costTokens: oe.costTokens,
      costPoints: oe.costPoints,
      maxPerUser: oe.maxPerUser,
    })),
  ];
  const [rows, setRows] = useState<ExistingRow[]>(initialRows);
  const [newRows, setNewRows] = useState<NewRow[]>([]);
  const [newDurationHours, setNewDurationHours] = useState(24);
  const [nextKey, setNextKey] = useState(0);

  function patchRow(i: number, patch: Partial<ExistingRow>) {
    setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }

  async function handleSaveRow(row: ExistingRow) {
    const ok = await updateArtwork({
      gameType: row.gameType,
      gameId: row.gameId,
      name: row.name,
      description: row.description,
      minPrice: row.minPrice,
      ticketCostTokens: row.ticketCostTokens,
      ticketCostPoints: row.ticketCostPoints,
      maxTickets: row.maxTickets,
      maxTicketsPerUser: row.maxTicketsPerUser,
      costTokens: row.costTokens,
      costPoints: row.costPoints,
      maxPerUser: row.maxPerUser,
    });
    if ('data' in ok && ok.data) toast.success(`Saved "${row.name}".`);
  }

  async function handleRemoveRow(row: ExistingRow, i: number) {
    if (
      !confirm(
        `Remove "${row.name}" from this draft?\n\nIts Arweave upload is already paid for and ` +
          `permanent — removing only unlinks it from the drop. Re-adding the same file later ` +
          `means paying for a fresh upload, so only remove pieces you don't want in the drop.`
      )
    )
      return;
    const ok = await deleteArtwork({ gameType: row.gameType, gameId: row.gameId });
    if ('data' in ok && ok.data) setRows((prev) => prev.filter((_, k) => k !== i));
  }

  function handleNewFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const added = files.map((file, i) => ({
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
    setNewRows((prev) => [...prev, ...added]);
    e.target.value = '';
  }

  function patchNewRow(key: number, patch: Partial<NewRow>) {
    setNewRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleUploadNew() {
    if (newRows.length === 0) return;
    const startDate = Math.floor(Date.now() / 1000) + 300;
    const result = await addArtworks({
      dropId: drop.id,
      artworks: newRows,
      startDate,
      endDate: startDate + newDurationHours * 3600,
    });
    if ('data' in result && result.data) setNewRows([]);
  }

  const busy = isUpdating || isDeleting || isAdding;

  return (
    <Modal title={`Edit drop #${drop.id} — ${drop.name}`} isOpen={isOpen} closeModal={closeModal}>
      <div style={{ padding: '20px', maxWidth: '640px', fontSize: '13px' }}>
        <em style={{ display: 'block', opacity: 0.75, marginBottom: '12px' }}>
          Name/price edits are free (nothing re-uploads — Arweave storage is already paid for).
          Only newly added files cost AR. After editing, run &quot;verify assets&quot; on the card,
          then approve &amp; deploy.
        </em>
        {rows.map((row, i) => (
          <div
            key={`${row.gameType}-${row.gameId}`}
            style={{ border: '1px solid rgba(128,128,128,.3)', borderRadius: '8px', padding: '10px', marginBottom: '10px' }}
          >
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <div style={{ position: 'relative', width: '64px', height: '64px', flexShrink: 0, overflow: 'hidden' }}>
                <BaseMedia src={row.mediaSrc} />
              </div>
              <div style={{ flexGrow: 1 }}>
                <input
                  className='create-drop-panel__input'
                  style={{ width: '100%' }}
                  value={row.name}
                  onChange={(e) => patchRow(i, { name: e.target.value })}
                />
                <textarea
                  className='create-drop-panel__input'
                  style={{ width: '100%', marginTop: '4px' }}
                  placeholder='description'
                  value={row.description}
                  onChange={(e) => patchRow(i, { description: e.target.value })}
                />
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                  {row.gameType === 'auction' && (
                    <label>
                      min bid (SAGE){' '}
                      <input
                        className='create-drop-panel__input'
                        type='number'
                        min='0'
                        step='any'
                        style={{ width: '90px' }}
                        value={row.minPrice}
                        onChange={(e) => patchRow(i, { minPrice: e.target.value })}
                      />
                    </label>
                  )}
                  {row.gameType === 'lottery' && (
                    <>
                      <label>
                        ticket (SAGE){' '}
                        <input className='create-drop-panel__input' type='number' min='0' step='any' style={{ width: '80px' }}
                          value={row.ticketCostTokens}
                          onChange={(e) => patchRow(i, { ticketCostTokens: Number(e.target.value) })} />
                      </label>
                      <label>
                        max tickets{' '}
                        <input className='create-drop-panel__input' type='number' min='0' style={{ width: '80px' }}
                          value={row.maxTickets}
                          onChange={(e) => patchRow(i, { maxTickets: Number(e.target.value) })} />
                      </label>
                      <label>
                        per user{' '}
                        <input className='create-drop-panel__input' type='number' min='0' style={{ width: '70px' }}
                          value={row.maxTicketsPerUser}
                          onChange={(e) => patchRow(i, { maxTicketsPerUser: Number(e.target.value) })} />
                      </label>
                    </>
                  )}
                  {row.gameType === 'openEdition' && (
                    <>
                      <label>
                        mint (SAGE){' '}
                        <input className='create-drop-panel__input' type='number' min='0' step='any' style={{ width: '80px' }}
                          value={row.costTokens}
                          onChange={(e) => patchRow(i, { costTokens: Number(e.target.value) })} />
                      </label>
                      <label>
                        per user{' '}
                        <input className='create-drop-panel__input' type='number' min='0' style={{ width: '70px' }}
                          value={row.maxPerUser}
                          onChange={(e) => patchRow(i, { maxPerUser: Number(e.target.value) })} />
                      </label>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                  <button
                    type='button'
                    className='dashboard__submit-button'
                    style={{ padding: '4px 14px' }}
                    disabled={busy}
                    onClick={() => handleSaveRow(row)}
                  >
                    save
                  </button>
                  <button
                    type='button'
                    className='dashboard__wipe-button'
                    style={{ padding: '4px 14px' }}
                    disabled={busy}
                    onClick={() => handleRemoveRow(row, i)}
                  >
                    remove
                  </button>
                  <span style={{ opacity: 0.6, alignSelf: 'center' }}>
                    {row.gameType === 'lottery' ? 'drawing' : row.gameType === 'openEdition' ? 'open edition' : 'auction'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}

        <div style={{ borderTop: '1px solid rgba(128,128,128,.3)', paddingTop: '12px', marginTop: '14px' }}>
          <label className='create-drop-panel__add-button'>
            + ADD MEDIA FILES
            <input type='file' multiple accept={ACCEPTED_MEDIA} style={{ display: 'none' }} onChange={handleNewFilesSelected} />
          </label>
          {newRows.length > 0 && (
            <label style={{ marginLeft: '12px' }}>
              sale duration{' '}
              <select
                className='create-drop-panel__input'
                value={newDurationHours}
                onChange={(e) => setNewDurationHours(Number(e.target.value))}
              >
                <option value={1}>1 hour</option>
                <option value={24}>1 day</option>
                <option value={72}>3 days</option>
                <option value={168}>1 week</option>
              </select>
            </label>
          )}
          {newRows.map((row) => (
            <div key={row.key} style={{ border: '1px dashed rgba(128,128,128,.4)', borderRadius: '8px', padding: '10px', marginTop: '8px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {row.previewUrl ? (
                  <img src={row.previewUrl} style={{ width: '48px', height: '48px', objectFit: 'cover' }} alt={row.name} />
                ) : (
                  <span style={{ width: '48px', height: '48px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>▶</span>
                )}
                <input
                  className='create-drop-panel__input'
                  placeholder='artwork name'
                  value={row.name}
                  onChange={(e) => patchNewRow(row.key, { name: e.target.value })}
                />
                <select
                  className='create-drop-panel__input'
                  value={row.saleType}
                  onChange={(e) => patchNewRow(row.key, { saleType: e.target.value as ArtworkSaleType })}
                >
                  <option value='auction'>Auction</option>
                  <option value='lottery'>Lottery</option>
                  <option value='openEdition'>Open Edition</option>
                </select>
                {row.saleType === 'auction' && (
                  <label>
                    min bid{' '}
                    <input className='create-drop-panel__input' type='number' min='0' step='any' style={{ width: '80px' }}
                      value={row.minPrice}
                      onChange={(e) => patchNewRow(row.key, { minPrice: Number(e.target.value) })} />
                  </label>
                )}
                {row.saleType === 'openEdition' && (
                  <label>
                    mint (SAGE){' '}
                    <input className='create-drop-panel__input' type='number' min='0' step='any' style={{ width: '80px' }}
                      value={row.costTokens}
                      onChange={(e) => patchNewRow(row.key, { costTokens: Number(e.target.value) })} />
                  </label>
                )}
                {row.saleType === 'lottery' && (
                  <label>
                    ticket (SAGE){' '}
                    <input className='create-drop-panel__input' type='number' min='0' step='any' style={{ width: '80px' }}
                      value={row.ticketCostTokens}
                      onChange={(e) => patchNewRow(row.key, { ticketCostTokens: Number(e.target.value) })} />
                  </label>
                )}
                <button
                  type='button'
                  className='create-drop-panel__remove-button'
                  onClick={() => setNewRows((prev) => prev.filter((r) => r.key !== row.key))}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          {newRows.length > 0 && (
            <button
              type='button'
              className='dashboard__submit-button'
              style={{ width: '100%', marginTop: '10px', height: '44px' }}
              disabled={busy}
              onClick={handleUploadNew}
            >
              {isAdding ? <LoaderSpinner /> : `upload & add ${newRows.length} file${newRows.length === 1 ? '' : 's'} (costs AR)`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
