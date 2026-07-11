import useModal from '@/hooks/useModal';
import { Drop_include_GamesAndArtist } from '@/prisma/types';
import { useApproveAndDeployDropMutation, useDeleteDropMutation } from '@/store/dropsReducer';
import { Signer } from 'ethers';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { useSigner } from 'wagmi';
import LoaderSpinner from '../LoaderSpinner';
import { BaseMedia, PfpImage } from '../Media/BaseMedia';
import { NewDropDetailsModal } from './NewDropDetailsModal';
import { AllowlistModal } from './AllowlistModal';

interface Props {
  drop: Drop_include_GamesAndArtist;
}

interface AssetCheck {
  label: string;
  txid: string;
}

type AssetStatus = Record<string, { ok: boolean; reason?: string }>;

/** extract a 43-char Arweave txid from an arweave.net URL, or null */
function arweaveTxid(url?: string | null): string | null {
  const m = url ? /arweave\.net\/([A-Za-z0-9_-]{43})/.exec(url) : null;
  return m ? m[1] : null;
}

export default function NewDropCard({ drop }: Props) {
  const { data: signer } = useSigner();
  const [approveAndDeployDrop, { isLoading: isDeploying }] = useApproveAndDeployDropMutation();
  const [deleteDrop, { isLoading: isDeleting }] = useDeleteDropMutation();
  const { isOpen, closeModal, openModal } = useModal();
  const {
    isOpen: isAllowlistOpen,
    closeModal: closeAllowlistModal,
    openModal: openAllowlistModal,
  } = useModal();
  const [assetStatus, setAssetStatus] = useState<AssetStatus>({});
  const [isVerifying, setIsVerifying] = useState(false);

  const nfts = [
    ...drop.Auctions.map((a) => a.Nft),
    ...drop.Lotteries.flatMap((l) => l.Nfts),
    ...drop.OpenEditions.map((oe) => oe.Nft),
  ].filter(Boolean);

  // The same asset set the deploy's pre-mint gate verifies (media master +
  // metadata per artwork, from arweavePath/metadataPath), plus the banner.
  // Rechecking THESE means "all green here" == "the deploy gate will pass".
  const assetChecks: AssetCheck[] = [];
  const bannerTxid = arweaveTxid(drop.bannerImageS3Path);
  if (bannerTxid) assetChecks.push({ label: 'banner', txid: bannerTxid });
  for (const nft of nfts) {
    const name = nft?.name || 'artwork';
    const mediaTxid = arweaveTxid(nft?.arweavePath);
    const metaTxid = arweaveTxid(nft?.metadataPath);
    const isVideo = !!nft?.arweavePath?.includes('filetype=mp4');
    if (mediaTxid) assetChecks.push({ label: `"${name}" ${isVideo ? 'video' : 'image'}`, txid: mediaTxid });
    if (metaTxid) assetChecks.push({ label: `"${name}" metadata`, txid: metaTxid });
  }
  // collection drops: same spot-checks the deploy gate runs (manifest +
  // first/last token metadata + first image) — not all 5,000
  for (const cm of (drop as any).CollectionMints ?? []) {
    if (cm.manifestId) assetChecks.push({ label: 'collection manifest', txid: cm.manifestId });
    if (cm.pathMap) {
      const map = JSON.parse(cm.pathMap);
      if (map['1']?.json) assetChecks.push({ label: 'first token metadata', txid: map['1'].json });
      if (map['1']?.img) assetChecks.push({ label: 'first image', txid: map['1'].img });
      const last = map[String(cm.maxSupply)];
      if (last?.json)
        assetChecks.push({ label: `last token metadata (#${cm.maxSupply})`, txid: last.json });
    }
  }

  // Troubleshooting recheck for the propagation-lag failure mode: a fresh
  // Arweave upload can take a while to become readable on the gateway, which
  // (correctly) fails the deploy's pre-mint verification. Rather than
  // re-uploading, the admin can recheck here until everything reports
  // retrievable, then approve & deploy — the gate will then pass.
  const handleVerifyBtnClick = async () => {
    setIsVerifying(true);
    try {
      await Promise.all(
        assetChecks.map(async ({ label, txid }) => {
          try {
            const res = await fetch(`/api/media/${txid}/?verify=1`);
            const data = await res.json().catch(() => ({}));
            setAssetStatus((prev) => ({
              ...prev,
              [label]: { ok: !!data.retrievable, reason: data.reason },
            }));
          } catch (e: any) {
            setAssetStatus((prev) => ({
              ...prev,
              [label]: { ok: false, reason: e?.message || 'check failed' },
            }));
          }
        })
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const handleApproveBtnClick = async () => {
    if (!signer) {
      toast.info('Sign In With Ethereum before continuing');
      return;
    }
    // success/failure toasts (with the failing step and reason) come from the
    // mutation itself
    await approveAndDeployDrop({ dropId: drop.id, signer: signer as Signer });
  };

  const handleDeleteBtnClick = async () => {
    if (!signer) {
      toast.info('Sign In With Ethereum before continuing');
      return;
    }
    if (confirm(`Permanently delete drop ${drop.id}?`)) {
      await deleteDrop(drop.id);
      toast.success(`Drop ${drop.id} has been deleted.`);
    }
  };

  const statusEntries = Object.entries(assetStatus);

  return (
    <div className='dashboard__tile'>
      <NewDropDetailsModal isOpen={isOpen} closeModal={closeModal} drop={drop} />
      {/* banner renders through the same resilient media path as the real
          drop page, so what the admin sees here is what visitors will get */}
      <div className='dashboard__tile-img'>
        <BaseMedia src={drop.bannerImageS3Path} onClickHandler={openModal} />
      </div>
      <div className='dashboard__tile-details'>
        <div className='dashboard__tile-artist-pfp'>
          <PfpImage src={drop.NftContract.Artist.profilePicture} />
        </div>
        <div className='dashboard__tile-artist-info'>
          <div className='dashboard__tile-nft-name'>{drop.name}</div>
          <div className='dashboard__tile-artist-name'>
            by {drop.NftContract.Artist.username || 'anon'}
          </div>
        </div>
      </div>
      {/* collection drops: processing status + preview of image #1 */}
      {((drop as any).CollectionMints ?? []).map((cm: any) => (
        <div key={`cm-${cm.id}`} style={{ fontSize: '12px', margin: '8px 0' }}>
          <div>
            collection: {cm.maxSupply > 0 ? `${cm.maxSupply} images` : 'processing…'} · status:{' '}
            <b style={{ color: cm.status === 'done' ? '#0c9d68' : cm.status === 'failed' ? '#dc2626' : undefined }}>
              {cm.status}
            </b>
            {cm.costTokens > 0 ? ` · ${cm.costTokens} SAGE per mint` : ' · free mint'}
          </div>
          {cm.previewImagePath && (
            <div style={{ position: 'relative', width: '31%', minWidth: '90px', paddingBottom: '31%', overflow: 'hidden', marginTop: '6px' }}>
              <div style={{ position: 'absolute', inset: 0 }}>
                <BaseMedia src={cm.previewImagePath} />
              </div>
            </div>
          )}
        </div>
      ))}
      {/* every artwork's DISPLAY media, live — confirms visually that the
          uploads work before approving, mirroring the actual drop page */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '10px 0' }}>
        {nfts.map((nft, i) => (
          <div key={i} style={{ width: '31%', minWidth: '90px' }}>
            <div style={{ position: 'relative', width: '100%', paddingBottom: '100%', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0 }}>
                <BaseMedia src={nft!.s3PathOptimized} />
              </div>
            </div>
            <div style={{ fontSize: '11px', textAlign: 'center', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {nft!.name}
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={handleVerifyBtnClick}
        disabled={isVerifying || isDeploying || isDeleting}
        className='dashboard__submit-button'
        style={{ width: '100%', display: 'inline-block', height: '50px' }}
      >
        {isVerifying ? <LoaderSpinner /> : 'verify assets on arweave'}
      </button>
      {statusEntries.length > 0 && (
        <div style={{ fontSize: '12px', lineHeight: '20px', margin: '8px 0' }}>
          {statusEntries.map(([label, s]) => (
            <div key={label} style={{ color: s.ok ? '#0c9d68' : '#dc2626' }}>
              {s.ok ? '✓' : '✗'} {label}
              {!s.ok && s.reason ? ` — ${s.reason}; a fresh upload can take a while to propagate, recheck in a few minutes` : ''}
            </div>
          ))}
        </div>
      )}
      <button
        onClick={handleApproveBtnClick}
        disabled={isDeploying || isDeleting}
        className='dashboard__submit-button'
        style={{ width: '100%', display: 'inline-block', height: '50px' }}
      >
        {isDeploying ? <LoaderSpinner /> : 'approve & deploy drop'}
      </button>
      <button
        onClick={openAllowlistModal}
        disabled={isDeploying || isDeleting}
        className='dashboard__submit-button'
        style={{ width: '100%', display: 'inline-block', height: '50px' }}
      >
        {(drop as any).allowlistEnabled ? 'allowlist (gated)' : 'allowlist'}
      </button>
      <AllowlistModal
        isOpen={isAllowlistOpen}
        closeModal={closeAllowlistModal}
        dropId={drop.id}
        dropName={drop.name}
        deployed={!!drop.approvedAt}
      />
      <button
        onClick={handleDeleteBtnClick}
        disabled={isDeploying || isDeleting}
        className='dashboard__submit-button'
        style={{ width: '100%', display: 'inline-block', height: '50px' }}
      >
        {isDeleting ? <LoaderSpinner /> : 'delete drop'}
      </button>
    </div>
  );
}
