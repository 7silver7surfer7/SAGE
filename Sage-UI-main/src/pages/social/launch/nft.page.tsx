import { useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import SocialShell from '@/components/Social/SocialShell';
import EditionPanel from '@/components/Social/EditionPanel';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import { useCreateDropWithUploadsMutation } from '@/store/dropsReducer';
import { useSetFollowGateMutation, useCreateDropPostMutation } from '@/store/socialReducer';
import VerificationModal from '@/components/Social/VerificationModal';
import { useSigner } from 'wagmi';

type LaunchKind = 'mint' | 'openEdition' | 'auction' | 'zip';

const KINDS: { key: LaunchKind; title: string; blurb: string; icon: string }[] = [
  {
    key: 'mint',
    title: 'Mint',
    blurb: 'One artwork, many mints. Live instantly — collectors pay gas. 1% / 99% you.',
    icon: '⬡',
  },
  {
    key: 'openEdition',
    title: 'Open edition',
    blurb: 'Timed open mint through the SAGE drop pipeline. Priced in ETH.',
    icon: '◎',
  },
  {
    key: 'auction',
    title: 'Auction',
    blurb: 'Single piece, highest bid wins. The FIRST BID starts the timer.',
    icon: '🔨',
  },
  {
    key: 'zip',
    title: 'ZIP collection',
    blurb: 'A ZIP of images → one token per image. Mint stays open until it sells out.',
    icon: '🗂',
  },
];

/**
 * The unified NFT launcher — every way to sell art, one Twitter-clean page.
 * Mint editions go through the self-serve social launcher (live instantly);
 * auctions / open editions / ZIP collections create a REAL drop in the SAGE
 * pipeline (curation queue → deploy), with an optional followers-only gate.
 */
export default function LaunchNftPage() {
  const router = useRouter();
  const { walletAddress, userData } = useSAGEAccount();
  const addr = walletAddress || (userData as any)?.walletAddress || '';
  const [kind, setKind] = useState<LaunchKind>('mint');

  // shared drop-form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [price, setPrice] = useState('0.01'); // reserve (auction) / mint price (OE, zip)
  const [durationHours, setDurationHours] = useState('24');
  const [maxPerUser, setMaxPerUser] = useState('0');
  const [followersOnly, setFollowersOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveDropId, setLiveDropId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [createDrop] = useCreateDropWithUploadsMutation();
  const [setFollowGate] = useSetFollowGateMutation();
  const [createDropPost] = useCreateDropPostMutation();
  const { data: signer } = useSigner();
  const [royalty, setRoyalty] = useState('10');
  const [showVerify, setShowVerify] = useState(false);

  const isZip = kind === 'zip';

  const submitDrop = async () => {
    if (!addr) {
      toast.info('Connect your wallet first');
      return;
    }
    if (!title.trim()) {
      toast.error('Give it a title');
      return;
    }
    if (!file) {
      toast.error(isZip ? 'Upload your ZIP of images' : 'Upload your artwork');
      return;
    }
    if (!signer) {
      toast.info('Connect your wallet — you sign the deploy (your gas, live instantly)');
      return;
    }
    const priceNum = Number(price) || 0;
    const hours = Number(durationHours) || 24;
    setBusy(true);
    const t = toast.loading(
      'Creating your drop — pinning art to IPFS, then your wallet prompts to deploy…'
    );
    try {
      const dropId = await createDrop({
        artistWallet: addr,
        name: title.trim(),
        description: description.trim(),
        bannerFile: file, // the artwork doubles as the drop banner
        artworks: isZip
          ? []
          : [
              {
                file,
                name: title.trim(),
                description: description.trim(),
                saleType: kind === 'auction' ? 'auction' : 'openEdition',
                minPrice: kind === 'auction' ? priceNum : 0,
                ticketCostTokens: 0,
                ticketCostPoints: 0,
                maxTickets: 0,
                maxTicketsPerUser: 0,
                costTokens: kind === 'openEdition' ? priceNum : 0,
                costPoints: 0,
                maxPerUser: Number(maxPerUser) || 0,
              },
            ],
        ...(isZip
          ? {
              collection: {
                zipFile: file,
                costTokens: priceNum,
                limitPerUser: Number(maxPerUser) || 0,
                // no deadline: ZIP collections mint until they SELL OUT
              },
            }
          : {}),
        durationHours: hours,
        // the CREATOR deploys on-chain right now, signing with their own
        // wallet — their gas, no studio queue, live immediately
        approveNow: true,
        signer: signer as any,
        goLiveAt: null,
        saleStartAt: null,
        royaltyPercentage: Math.min(50, Math.max(0, Number(royalty) || 0)),
        currency: 'ETH',
        // social NFTs live on IPFS via Filebase — no admin-gated Arweave path
        storage: 'filebase',
        allowlist: { enabled: false, addresses: [] },
      }).unwrap();
      if (!dropId) throw new Error('drop creation failed — see the error above');
      if (followersOnly && dropId) {
        // followers auto-join the allowlist (pushed on-chain at deploy)
        await setFollowGate({ dropId, enabled: true })
          .unwrap()
          .catch(() =>
            toast.warn('Drop created, but the follower gate needs enabling from the drop page')
          );
      }
      // the drop becomes a FEED POST — likes/replies/shares like any tweet,
      // with the bid/mint CTA on the card
      await createDropPost({ dropId, kind: kind === 'zip' ? 'collection' : kind })
        .unwrap()
        .catch(() => toast.warn('Drop is live, but the feed post failed — share it manually'));
      setLiveDropId(dropId);
      toast.update(t, {
        render: 'Live! Your drop is deployed and posted to the feed 🎨',
        type: 'success',
        isLoading: false,
        autoClose: 6000,
      });
    } catch (e: any) {
      toast.update(t, {
        render: e?.data?.error || e?.message?.slice(0, 90) || 'Could not create the drop',
        type: 'error',
        isLoading: false,
        autoClose: 7000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header'>
          <h1 className='social__title'>LAUNCH NFT</h1>
          <p className='social__subtitle'>every way to sell your art — pick a format</p>
        </header>

        {!addr ? (
          <div className='social__empty'>Connect your wallet to launch.</div>
        ) : liveDropId ? (
          <div className='social-launch__done'>
            <h3>🎉 “{title}” is in the pipeline</h3>
            <p>
              Your {kind === 'auction' ? 'auction' : isZip ? 'collection' : 'open edition'}
              {followersOnly ? ' (followers-only)' : ''} is DEPLOYED and live as drop #{liveDropId},
              and it's on the feed as a post — bids/mints happen right from the timeline.
            </p>
            <div className='social-launch__done-row'>
              <button
                className='social-verify__buy'
                onClick={() =>
                  router.push(
                    `/social/compose?draft=${encodeURIComponent(
                      `Something new is coming: “${title}” 🎨 ${
                        followersOnly ? 'Follow me to get on the allowlist — ' : ''
                      }watch this space.`
                    )}`
                  )
                }
              >
                Tease it on your feed
              </button>
              <button className='social-refer__btn' onClick={() => setLiveDropId(null)}>
                Launch another
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* format picker — Twitter-card row */}
            <div className='social-launch__kinds'>
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  className='social-launch__kind'
                  data-active={kind === k.key}
                  onClick={() => {
                    if (k.key === kind) return;
                    setKind(k.key);
                    // a ZIP is not an artwork and vice versa — switching
                    // formats starts a fresh form instead of carrying the
                    // previous upload over
                    setFile(null);
                    if (fileRef.current) fileRef.current.value = '';
                    setTitle('');
                    setDescription('');
                    setPrice('0.01');
                    setDurationHours('24');
                    setMaxPerUser('0');
                    setFollowersOnly(false);
                  }}
                >
                  <span className='social-launch__kind-icon'>{k.icon}</span>
                  <b>{k.title}</b>
                  <span className='social-launch__kind-blurb'>{k.blurb}</span>
                </button>
              ))}
            </div>

            {kind === 'mint' ? (
              <div className='social-launch__mint'>
                <p className='social-launch__note'>
                  Mint editions are self-serve and live the moment you sign — no curation queue.
                </p>
                <EditionPanel address={addr} isSelf />
              </div>
            ) : (
              <div className='social-launch__form'>
                <input
                  className='social-search__input'
                  placeholder={isZip ? 'Collection title' : 'Artwork title'}
                  value={title}
                  maxLength={60}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <textarea
                  className='social-search__input social-launch__desc'
                  placeholder='Say something about it (shown on the drop page)'
                  value={description}
                  maxLength={1000}
                  rows={3}
                  onChange={(e) => setDescription(e.target.value)}
                />

                <input
                  ref={fileRef}
                  type='file'
                  accept={isZip ? '.zip,application/zip' : 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime'}
                  style={{ display: 'none' }}
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <button
                  className='social-refer__btn social-launch__file'
                  onClick={() => fileRef.current?.click()}
                >
                  {file ? `✓ ${file.name} — replace` : isZip ? 'Upload ZIP of images' : 'Upload artwork'}
                </button>

                <div className='social-launch__row'>
                  <div className='social-unit-input'>
                    <input
                      placeholder={kind === 'auction' ? 'Reserve price' : 'Mint price'}
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                    <span>ETH</span>
                  </div>
                  {!isZip && (
                    <div className='social-unit-input'>
                      <input
                        placeholder={kind === 'auction' ? 'Timer (starts on first bid)' : 'Duration'}
                        value={durationHours}
                        onChange={(e) => setDurationHours(e.target.value)}
                      />
                      <span>HOURS</span>
                    </div>
                  )}
                  {kind !== 'auction' && (
                    <div className='social-unit-input'>
                      <input
                        placeholder='0 = unlimited'
                        value={maxPerUser}
                        onChange={(e) => setMaxPerUser(e.target.value)}
                      />
                      <span>PER WALLET</span>
                    </div>
                  )}
                </div>

                <div className='social-launch__row'>
                  <div className='social-unit-input'>
                    <input
                      placeholder='Secondary royalty'
                      value={royalty}
                      onChange={(e) => setRoyalty(e.target.value)}
                    />
                    <span>% ROYALTY</span>
                  </div>
                </div>
                <label className='social-launch__gate'>
                  <input
                    type='checkbox'
                    checked={followersOnly}
                    onChange={(e) => setFollowersOnly(e.target.checked)}
                  />
                  <span>
                    <b>Followers only</b>
                    <small>
                      Anyone who follows you on SAGE Social is auto-added to the allowlist — turn
                      your audience into your collectors.
                    </small>
                  </span>
                </label>

                <button className='social-verify__buy' disabled={busy} onClick={submitDrop}>
                  {busy
                    ? 'Creating…'
                    : kind === 'auction'
                    ? 'Create auction'
                    : isZip
                    ? 'Create collection drop'
                    : 'Create open edition'}
                </button>
                <p className='social-launch__fine'>
                  You sign the on-chain deploy with your wallet (your gas) — live the moment it
                  confirms, plus a feed post where people bid/mint. Priced in ETH · your royalty
                  on every secondary sale.
                  {isZip && ' ZIP mints have no deadline — they run until sold out.'}
                  {kind === 'auction' && ' The auction clock starts at the first bid (anti-snipe extensions built in).'}
                </p>
              </div>
            )}
          </>
        )}
      </div>
      {showVerify && <VerificationModal onClose={() => setShowVerify(false)} />}
    </SocialShell>
  );
}
