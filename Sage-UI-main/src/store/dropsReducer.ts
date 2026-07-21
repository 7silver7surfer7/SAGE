import { ethers, Signer } from 'ethers';
import { DropFull, Drop_include_GamesAndArtist, Splitter_include_Entries } from '@/prisma/types';
import { toast } from 'react-toastify';
import {
  assertSignerOnConfiguredChain,
  extractErrorMessage,
  getAuctionContract,
  getCollectionContract,
  getLotteryContract,
  getNFTContract,
  getOpenEditionContract,
} from '@/utilities/contracts';
import splitterContractJson from '@/constants/abis/Utils/Splitter.sol/Splitter.json';
import sageWhitelistJson from '@/constants/abis/Utils/SageWhitelist.sol/SageWhitelist.json';
import { parameters, currencyAddressFor, isEthCurrency } from '@/constants/config';
import { chunk, ALLOWLIST_CHUNK_SIZE } from '@/utilities/allowlist';
import { fetchOrCreateNftContract } from './nftsReducer';
import { baseApi } from './baseReducer';
import { Role } from '@prisma/client';
import { createNftMetadataOnArweave, uploadFileToArweave } from '@/utilities/arweave-client';
import { uploadFileToS3 } from '@/utilities/awsS3-client';
import { dropProgress } from '@/utilities/dropProgress';
import { isVideoSrc } from '@/utilities/media';
import { toDecimalString } from '@/utilities/decimalString';
import { retryTransient } from '@/utilities/retryTransient';

// SAGE Social's primary-sale split: 99% artist / 1% platform — distinct from
// the shared marketplace SageConfig dial (default 80/20). Applied to a
// social drop's game(s) right after creation via each contract's admin
// setArtistShare-style setter (Auction/OpenEdition/SageCollection all share
// this frozen-per-game-with-admin-override pattern).
const SOCIAL_ARTIST_SHARE_BPS = 9900;

export type ArtworkSaleType = 'auction' | 'lottery' | 'openEdition';

export interface NewDropArtwork {
  file: File;
  name: string;
  description: string;
  saleType: ArtworkSaleType;
  // auction
  minPrice: number;
  // lottery
  ticketCostTokens: number;
  ticketCostPoints: number;
  maxTickets: number;
  maxTicketsPerUser: number;
  // open edition
  costTokens: number;
  costPoints: number;
  maxPerUser: number;
}

export interface CreateDropRequest {
  artistWallet: string;
  /** optional display name shown as the artist for THIS drop only — frozen at
   *  creation, does not rename the wallet's site-wide profile username and
   *  does not carry over to other drops by the same wallet. */
  artistDisplayName?: string;
  /** Optional logo for the artist. Uploaded to Arweave and stored as the
   *  artist's User.profilePicture, so it replaces the default SAGE icon
   *  wherever the artist is shown (drop pages, tiles, creators page). */
  artistIconFile?: File | null;
  name: string;
  description: string;
  bannerFile: File;
  artworks: NewDropArtwork[];
  durationHours: number;
  approveNow: boolean;
  /** unix seconds; when set the drop stays hidden until this time */
  goLiveAt: number | null;
  /** unix seconds; when the auctions/lottery/mint windows actually open.
   *  Independent of goLiveAt — lets a drop be visible immediately while its
   *  sales open later, or vice versa. Defaults to goLiveAt, then to now+5min. */
  saleStartAt: number | null;
  /** When provided, "approve now" deploys the drop on-chain (prompts wallet
   *  signatures) via the same path New Drops uses, instead of a DB-only flag flip. */
  signer?: Signer;
  /** Optional allowlist gating, saved with the draft right after the drop row
   *  is created. The whitelist contract itself deploys at approval time. */
  allowlist?: { enabled: boolean; addresses: string[] };
  /** Secondary-sale royalty in PERCENT (12 = 12%). Stamped on the artist's
   *  NFT contract (as basis points) at deploy; every token minted for this
   *  drop keeps it permanently. Marketplace re-sales only. */
  royaltyPercentage: number;
  /** Payment currency for every game in this drop. "SAGE" (default) or "ETH"
   *  (native). Baked into the game contracts at deploy. */
  currency?: 'SAGE' | 'ETH';
  /** Where media + metadata live: 'arweave' (default, admin drop studio) or
   *  'filebase' (IPFS — the social launcher path, no admin-gated uploads). */
  storage?: 'arweave' | 'filebase';
  /** One mint spot per IP: minting requires claiming a server-verified spot
   *  (salted-IP dedup) which whitelists the wallet on-chain. Sybil speed
   *  bump, not a wall. */
  ipGateEnabled?: boolean;
  /** Custom ERC-721 ticker/symbol for this drop's NFT contract. For Open
   *  Edition/Auction this only takes effect the FIRST time this artist's
   *  shared contract deploys (immutable after — ignored on later drops); for
   *  a ZIP collection it always applies, since each one gets its own fresh
   *  dedicated contract. Omitted/empty falls back to auto-deriving one from
   *  the display name (artist or drop, respectively), same as before. */
  nftSymbol?: string;
  /** Collection drop mode: a ZIP of unique images bulk-uploaded to Arweave;
   *  collectors mint sequentially at a fixed SAGE price. When set, `artworks`
   *  is ignored — the zip IS the drop's content. */
  collection?: {
    zipFile: File;
    costTokens: number;
    limitPerUser: number;
    /** hours the mint stays open; 0/undefined = NO deadline — the default:
     *  the mint stays open until the collection sells out */
    durationHours?: number;
  };
}

export interface DropAllowlistData {
  enabled: boolean;
  whitelistContractAddress: string | null;
  entries: { address: string; syncedAt: string | null }[];
}

export interface PresetDropArtist {
  walletAddress: string;
  username: string | null;
  role: Role | null;
}

export interface PresetDrop {
  artist: PresetDropArtist;
  dropName: string;
  bannerS3Path: string;
  nfts: string[]; // s3 paths
}

export const dropsApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    createPresetDrops: builder.mutation<boolean, { presetDrops: PresetDrop[]; durationHours: number }>(
      {
        queryFn: async ({ presetDrops, durationHours }, {}, _, fetchWithBQ) => {
          try {
            await createPresetDrops(presetDrops, durationHours, fetchWithBQ);
            return { data: true };
          } catch (e) {
            console.log(e);
          }
          return { data: false };
        },
        invalidatesTags: ['PendingDrops'],
      }
    ),
    // `fullyDeployed: false` (drop row created, but a later step — upload,
    // on-chain deploy — failed) must NEVER be treated the same as a clean
    // success by a caller: it used to resolve to a bare truthy dropId,
    // which let the self-serve launcher post "it's live!" to the feed and
    // invite mints/bids on a drop that wasn't actually deployed. Every
    // caller MUST check fullyDeployed before doing anything that presents
    // the drop as ready (posting, "Live!" messaging, share links).
    createDropWithUploads: builder.mutation<
      { dropId: number; fullyDeployed: boolean },
      CreateDropRequest
    >({
      queryFn: async (req, {}, _, fetchWithBQ) => {
        // Once the drop row exists, a later failure (usually the on-chain
        // deploy) must NOT read as "the drop failed" — the uploads are done
        // and the deploy can be retried from the New Drops tab.
        let createdDropId = 0;
        dropProgress.reset();
        dropProgress.note(
          req.collection
            ? `Creating collection drop "${req.name}" (bulk zip)`
            : `Creating drop "${req.name}" (${req.artworks.length} artwork${req.artworks.length === 1 ? '' : 's'})`
        );
        try {
          // A ZIP collection's "banner" is the zip itself — nothing uploadable
          // as an image. Leave the banner empty; the collection processor
          // patches in the FIRST IMAGE once the zip is unpacked and pinned.
          const bannerIsZip =
            /zip/i.test(req.bannerFile.type || '') || /\.zip$/i.test(req.bannerFile.name || '');
          const { url: bannerUrl, posterUrl: bannerPosterUrl } = bannerIsZip
            ? { url: '', posterUrl: undefined }
            : await dropProgress.track(
                req.storage === 'filebase' ? 'Uploading banner to Filebase (IPFS)' : 'Uploading banner to Arweave',
                () =>
                  req.storage === 'filebase'
                    ? uploadFileToFilebase(req.bannerFile)
                    : uploadFileToArweave(req.bannerFile)
              );
          // bannerImageS3Path/tileImageS3Path render as plain <img> in several
          // places (dashboard cards, feed post previews) that don't know how
          // to play video — a video banner needs its first-frame poster here,
          // never the raw video URL (see extractFirstFrame in social-upload).
          // The real clip (when there is one) still gets persisted separately
          // as bannerVideoS3Path, for the one surface that DOES play video:
          // this drop's own announcement post on the social feed.
          const resolvedBannerUrl = bannerPosterUrl || bannerUrl;
          const bannerVideoUrl = bannerPosterUrl ? bannerUrl : undefined;
          let artistProfilePicture: string | undefined;
          if (req.artistIconFile) {
            const { url, optimizedUrl } = await dropProgress.track(
              'Uploading artist icon',
              () =>
                req.storage === 'filebase'
                  ? uploadFileToFilebase(req.artistIconFile as File)
                  : uploadFileToArweave(req.artistIconFile as File)
            );
            artistProfilePicture = optimizedUrl || url;
          }
          const { data: dropResult, error: dropError } = await dropProgress.track(
            'Creating drop record',
            async () =>
            fetchWithBQ({
              url: 'endpoints/dropUpload?action=InsertDrop',
              method: 'POST',
              body: {
                artistWallet: req.artistWallet,
                artistDisplayName: req.artistDisplayName,
                artistProfilePicture,
                name: req.name,
                description: req.description,
                bannerImageS3Path: resolvedBannerUrl,
                tileImageS3Path: resolvedBannerUrl,
                bannerVideoS3Path: bannerVideoUrl,
                goLiveAt: req.goLiveAt,
                royaltyPercentage: req.royaltyPercentage,
                currency: req.currency || 'SAGE',
                ipGateEnabled: !!req.ipGateEnabled,
                storage: req.storage || 'arweave',
                nftSymbol: req.nftSymbol,
              },
            })
          );
          if ((dropResult as any)?.error) throw new Error((dropResult as any).error);
          // fetchWithBQ signals HTTP-level failures (401/403/500) via `error`
          // with NO data — reading .dropId off undefined was the old crash
          if (dropError || !(dropResult as any)?.dropId) {
            throw new Error(
              (dropError as any)?.data?.error ||
                (dropError as any)?.error ||
                'creating the drop record failed — are you signed in?'
            );
          }
          const dropId = (dropResult as any).dropId as number;
          createdDropId = dropId;
          if (req.allowlist?.enabled && req.allowlist.addresses.length > 0) {
            await dropProgress.track(
              `Saving allowlist (${req.allowlist.addresses.length} addresses)`,
              async () => {
                const { data: alRes, error: alErr } = await fetchWithBQ({
                  url: 'drops?action=SaveDropAllowlist',
                  method: 'POST',
                  body: { dropId, addresses: req.allowlist!.addresses, enabled: true },
                });
                if (alErr || (alRes as any)?.error) {
                  throw new Error(
                    ((alErr as any)?.data?.error || (alRes as any)?.error) ?? 'allowlist save failed'
                  );
                }
              }
            );
          }
          // games open at the explicit sale-start time; falling back to go-live
          // (old single-timestamp behavior), then to 5 minutes from now
          const startDate =
            req.saleStartAt ?? req.goLiveAt ?? Math.floor(Date.now() / 1000) + 300;
          const endDate = startDate + req.durationHours * 3600;
          const endpoint = '/api/endpoints/dropUpload/';
          if (req.collection) {
            await runCollectionPipeline(dropId, req, startDate, endDate, fetchWithBQ);
          }
          if (!req.collection) {
            await uploadAndRegisterArtworks(dropId, req.artworks, startDate, endDate, fetchWithBQ, req.storage || 'arweave');
          }
          if (req.approveNow) {
            if (req.signer) {
              // real on-chain deploy: creates/reuses the artist's NFT contract
              // and registers the auctions/lotteries/open editions, prompting
              // wallet signatures. Also flips approvedAt/isLive when done.
              // deployDrop emits its own per-step progress (see deployStep).
              dropProgress.note('Minting on-chain — approve each wallet prompt');
              await deployDrop(dropId, req.signer, fetchWithBQ);
            } else {
              await dropProgress.track('Approving drop (off-chain)', async () =>
                fetchWithBQ(`drops?action=UpdateApprovedDateAndIsLiveFlags&id=${dropId}`)
              );
            }
          }
          dropProgress.note(`Done — drop "${req.name}" (#${dropId}) is ready.`);
          dropProgress.finish();
          toast.success(`Drop '${req.name}' created!`);
          return { data: { dropId, fullyDeployed: true } };
        } catch (e: any) {
          console.error('createDropWithUploads() failed', e);
          const message = extractErrorMessage(e);
          dropProgress.finish();
          if (createdDropId) {
            toast.error(
              `Drop '${req.name}' (#${createdDropId}) was created and its media uploaded, ` +
                `but a later step failed: ${message} — fix the issue and retry the deploy ` +
                `from the New Drops tab (no need to re-upload).`,
              { autoClose: false }
            );
            // the drop exists (so the form can clear / a retry flow can find
            // it by id), but it is NOT live — fullyDeployed:false is the
            // signal every caller must check before posting/announcing it
            return { data: { dropId: createdDropId, fullyDeployed: false } };
          }
          toast.error(`Error creating drop: ${message}`, { autoClose: false });
          return { data: { dropId: 0, fullyDeployed: false } };
        }
      },
      invalidatesTags: ['PendingDrops'],
    }),
    getApprovedDrops: builder.query<Drop_include_GamesAndArtist[], void>({
      query: () => `drops?action=GetApprovedDrops`,
      providesTags: ['PendingDrops'],
    }),
    getDropsPendingApproval: builder.query<DropFull[], void>({
      query: () => `drops?action=GetDropsPendingApproval`,
      providesTags: ['PendingDrops'],
    }),
    getPresetDrops: builder.query<PresetDrop[], void>({
      queryFn: async (undefined, {}, _, fetchWithBQ) => {
        // retry this operation because aws-sdk fails server-side randomly
        return { data: await fetchWithRetries(`drops?action=GetPresetDrops`, 5, fetchWithBQ) };
      },
    }),
    approveAndDeployDrop: builder.mutation<boolean, { dropId: number; signer: Signer }>({
      queryFn: async ({ dropId, signer }, { dispatch }, _, fetchWithBQ) => {
        dropProgress.reset();
        dropProgress.note(`Minting drop #${dropId} on-chain — approve each wallet prompt`);
        try {
          await deployDrop(dropId, signer, fetchWithBQ);
          dropProgress.note(`Done — drop #${dropId} deployed.`);
          dropProgress.finish();
          dispatch(dropsApi.util.invalidateTags(['PendingDrops'])); // refetch pending drops
          toast.success(`Drop #${dropId} deployed on-chain!`);
          return { data: true };
        } catch (e: any) {
          dropProgress.finish();
          console.error(`approveAndDeployDrop(${dropId}) failed`, e);
          toast.error(`Deploy of drop #${dropId} failed — ${extractErrorMessage(e)}`, {
            autoClose: false,
          });
          return { data: false };
        }
      },
    }),
    deleteDrop: builder.mutation<null, number>({
      query: (dropId) => `drops?action=DeleteDrop&id=${dropId}`,
      invalidatesTags: ['PendingDrops'],
    }),
    getDropAllowlist: builder.query<DropAllowlistData, number>({
      query: (dropId) => `drops?action=GetDropAllowlist&id=${dropId}`,
      providesTags: (_r, _e, dropId) => [{ type: 'DropAllowlist', id: dropId }],
    }),
    checkDropAllowlist: builder.query<{ gated: boolean; allowed: boolean }, number>({
      query: (dropId) => `drops?action=CheckDropAllowlist&id=${dropId}`,
      providesTags: (_r, _e, dropId) => [{ type: 'DropAllowlist', id: dropId }],
    }),
    /**
     * Saves the allowlist (DB) and — when the drop is already deployed — syncs
     * it on-chain in the same click: deploys the SageWhitelist if this is the
     * first time gating a deployed drop (wiring every deployed OE/lottery via
     * setWhitelist), pushes unsynced addresses in chunks, and un-wires the
     * games (AddressZero) when gating is being disabled. Draft drops save
     * DB-only; their contract work happens at approval in deployDrop.
     */
    updateDropAllowlist: builder.mutation<
      { total: number; pendingSync: number },
      { dropId: number; addresses: string[]; enabled: boolean; signer?: Signer }
    >({
      queryFn: async ({ dropId, addresses, enabled, signer }, {}, _, fetchWithBQ) => {
        try {
          const { data: saveRes, error: saveErr } = await fetchWithBQ({
            url: 'drops?action=SaveDropAllowlist',
            method: 'POST',
            body: { dropId, addresses, enabled },
          });
          if (saveErr || (saveRes as any)?.error) {
            throw new Error(
              ((saveErr as any)?.data?.error || (saveRes as any)?.error) ?? 'save failed'
            );
          }
          const dropRes = await fetchWithBQ(`drops?action=GetFullDrop&id=${dropId}`);
          const drop = dropRes.data as DropFull;
          const isDeployed = !!drop?.approvedAt;
          if (isDeployed && signer) {
            await assertSignerOnConfiguredChain(signer);
            const allowlistRes = await fetchWithBQ(`drops?action=GetDropAllowlist&id=${dropId}`);
            const allowlist = allowlistRes.data as DropAllowlistData;
            if (enabled) {
              const hadContract = !!allowlist.whitelistContractAddress;
              const contractAddress = await deployAndSyncAllowlist(drop, signer, fetchWithBQ);
              if (contractAddress !== ethers.constants.AddressZero && !hadContract) {
                // first-time gating of an already-deployed drop: wire its games
                await setGamesWhitelist(drop, contractAddress, signer);
              }
            } else if (allowlist.whitelistContractAddress) {
              // gating turned OFF after deploy: un-wire on-chain too, or the
              // contracts keep blocking while the UI reports the drop as open
              await setGamesWhitelist(drop, ethers.constants.AddressZero, signer);
            }
          }
          const countsRes = await fetchWithBQ(`drops?action=GetDropAllowlist&id=${dropId}`);
          const counts = countsRes.data as DropAllowlistData;
          const pendingSync =
            counts?.entries?.filter((e) => !e.syncedAt).length ?? 0;
          const message = isDeployed && signer && pendingSync > 0
            ? `Allowlist saved, but ${pendingSync} address(es) are not yet on-chain — retry the sync.`
            : 'Allowlist saved!';
          pendingSync > 0 && isDeployed ? toast.warn(message) : toast.success(message);
          return { data: { total: counts?.entries?.length ?? 0, pendingSync } };
        } catch (e: any) {
          console.error('updateDropAllowlist() failed', e);
          toast.error(`Allowlist update failed — ${extractErrorMessage(e)}`, { autoClose: false });
          return { error: { status: 500, data: extractErrorMessage(e) } as any };
        }
      },
      invalidatesTags: (_r, _e, { dropId }) => [
        { type: 'DropAllowlist', id: dropId },
        'PendingDrops',
      ],
    }),
    deleteDrops: builder.mutation<null, void>({
      query: () => `drops?action=DeleteDrops`,
      invalidatesTags: ['PendingDrops'],
    }),
    /** Adds artworks to a SAVED DRAFT — pays Arweave only for the new files;
     *  everything already uploaded is reused as-is. */
    addArtworksToDrop: builder.mutation<
      boolean,
      { dropId: number; artworks: NewDropArtwork[]; startDate: number; endDate: number }
    >({
      queryFn: async ({ dropId, artworks, startDate, endDate }, {}, _, fetchWithBQ) => {
        dropProgress.reset();
        dropProgress.note(
          `Adding ${artworks.length} artwork${artworks.length === 1 ? '' : 's'} to drop #${dropId}`
        );
        try {
          await uploadAndRegisterArtworks(dropId, artworks, startDate, endDate, fetchWithBQ);
          dropProgress.note('Done — run "verify assets" before approving.');
          dropProgress.finish();
          toast.success(`Added ${artworks.length} artwork${artworks.length === 1 ? '' : 's'}.`);
          return { data: true };
        } catch (e: any) {
          console.error('addArtworksToDrop() failed', e);
          dropProgress.finish();
          toast.error(`Adding artworks failed: ${extractErrorMessage(e)}`, { autoClose: false });
          return { data: false };
        }
      },
      invalidatesTags: ['PendingDrops'],
    }),
    /** DB-only edit of a draft artwork (name/description/sale params) — free,
     *  never touches Arweave. */
    updateDraftArtwork: builder.mutation<boolean, Record<string, any>>({
      queryFn: async (body, {}, _, fetchWithBQ) => {
        const { data, error } = await fetchWithBQ({
          url: 'endpoints/dropUpload?action=UpdateDraftArtwork',
          method: 'POST',
          body,
        });
        const err = (error as any)?.data?.error || (data as any)?.error;
        if (err) {
          toast.error(`Update failed: ${err}`);
          return { data: false };
        }
        return { data: true };
      },
      invalidatesTags: ['PendingDrops'],
    }),
    deleteDraftArtwork: builder.mutation<boolean, { gameType: string; gameId: number }>({
      queryFn: async (body, {}, _, fetchWithBQ) => {
        const { data, error } = await fetchWithBQ({
          url: 'endpoints/dropUpload?action=DeleteDraftArtwork',
          method: 'POST',
          body,
        });
        const err = (error as any)?.data?.error || (data as any)?.error;
        if (err) {
          toast.error(`Remove failed: ${err}`);
          return { data: false };
        }
        toast.success('Artwork removed from the draft.');
        return { data: true };
      },
      invalidatesTags: ['PendingDrops'],
    }),
    // OpenEdition.mintCount in the DB is a snapshot set to 0 at deploy time
    // and never updated after — reading it directly means every "X minted"
    // display sticks at its deploy-time value forever. The contract tracks
    // the real count as mints happen, so read it live instead.
    getOpenEditionMintCount: builder.query<number, number>({
      queryFn: async (editionId) => {
        try {
          const contract = await getOpenEditionContract();
          const count = await contract.getMintCount(editionId);
          return { data: Number(count) };
        } catch (e) {
          console.error(`getOpenEditionMintCount(${editionId}) failed`, e);
          return { error: { status: 400, data: {} } };
        }
      },
      providesTags: (_result, _error, editionId) => [
        { type: 'OpenEditionMintCount', id: editionId },
      ],
    }),
    // Same live-read rationale as getOpenEditionMintCount, for collections.
    // contractAddress is the specific SageCollection instance this row was
    // minted through — collections created before the 2026-07-14
    // one-tx-deploy switch live on an older contract than the current global
    // default, so it must be threaded through rather than assumed.
    getCollectionMintCount: builder.query<number, { collectionId: number; contractAddress?: string }>({
      queryFn: async ({ collectionId, contractAddress }) => {
        try {
          const contract = await getCollectionContract(undefined, contractAddress);
          const count = await contract.getMintCount(collectionId);
          return { data: Number(count) };
        } catch (e) {
          console.error(`getCollectionMintCount(${collectionId}) failed`, e);
          return { error: { status: 400, data: {} } };
        }
      },
      providesTags: (_result, _error, { collectionId }) => [
        { type: 'CollectionMintCount', id: collectionId },
      ],
    }),
  }),
});

function addHours(numOfHours: number, date = new Date()) {
  date.setTime(date.getTime() + numOfHours * 60 * 60 * 1000);
  return date;
}

async function fetchWithRetries(url: string, retriesLeft: number, fetchWithBQ: any): Promise<any> {
  try {
    console.log(`fetchWithRetries('${url}') :: ${retriesLeft} retries left`);
    const result = await fetchWithBQ(url);
    if (result.error) {
      throw new Error();
    }
    return result.data;
  } catch (e) {
    if (retriesLeft > 1) {
      return await fetchWithRetries(url, --retriesLeft, fetchWithBQ);
    }
    throw e;
  }
}

async function createPresetDrops(
  presetDrops: PresetDrop[],
  durationHours: number,
  fetchWithBQ: any
) {
  // TODO fix test paths below
  const metadataPath = 'https://arweave.net/2capUuzTo1t4SPe3VGEwBmkrgFMPgFMgdQdKo3Msqgo';
  const arweavePath = 'https://arweave.net/2capUuzTo1t4SPe3VGEwBmkrgFMPgFMgdQdKo3Msqgo';
  const startDate = Math.floor(addHours(0.0833).getTime() / 1000); // starts in 5 minutes
  const endDate = Math.floor(addHours(durationHours + 0.0833).getTime() / 1000);
  await checkUsersExistAndAreArtists(presetDrops, fetchWithBQ);
  for (const presetDrop of presetDrops) {
    const { data: dropResult } = await fetchWithBQ({
      url: `endpoints/dropUpload?action=InsertDrop`,
      method: 'POST',
      body: {
        artistWallet: presetDrop.artist.walletAddress,
        name: presetDrop.dropName,
        bannerImageS3Path: presetDrop.bannerS3Path,
      },
    });
    const dropId = (dropResult as any).dropId as number;
    console.log(`createPresetDrops() :: Added drop ${dropId}`);
    for (const nftS3Path of presetDrop.nfts) {
      if (Math.random() > 0.6) {
        // Auction
        const { data: auctionResult } = await fetchWithBQ({
          url: `endpoints/dropUpload?action=InsertAuction`,
          method: 'POST',
          body: {
            dropId,
            minPrice: '1',
            bannerImageS3Path: presetDrop.bannerS3Path,
            width: 1024,
            height: 1024,
            startDate,
            endDate,
            name: nftS3Path.split('/').pop().split('.')[0].replace('%20', ' '),
            metadataPath,
            arweavePath,
            s3Path: nftS3Path,
            s3PathOptimized: nftS3Path,
          },
        });
        const auctionId = (auctionResult as any).auctionId as number;
        console.log(`createPresetDrops() :: Added auction ${auctionId} to drop ${dropId}`);
      } else {
        // Drawing
        const { data: drawingResult } = await fetchWithBQ({
          url: `endpoints/dropUpload?action=InsertDrawing`,
          method: 'POST',
          body: {
            dropId,
            ticketCostTokens: Math.random() > 0.5 ? 1 : 2,
            ticketCostPoints: Math.random() > 0.5 ? 0 : 1,
            maxTickets: 0,
            maxTicketsPerUser: 0,
            startDate,
            endDate,
          },
        });
        const drawingId = (drawingResult as any).drawingId as number;
        console.log(`createPresetDrops() :: Added drawing ${drawingId} to drop ${dropId}`);
        const { data: nftResult } = await fetchWithBQ({
          url: `endpoints/dropUpload?action=InsertNft`,
          method: 'POST',
          body: {
            dropId,
            drawingId,
            name: nftS3Path.split('/').pop().split('.')[0].replace('%20', ' '),
            numberOfEditions: 1,
            width: 1024,
            height: 1024,
            metadataPath,
            arweavePath,
            s3Path: nftS3Path,
            s3PathOptimized: nftS3Path,
          },
        });
        const nftId = (nftResult as any).nftId as number;
        console.log(`createPresetDrops() :: Added nft ${nftId} to drawing ${drawingId}`);
      }
    }
  }
}

async function checkUsersExistAndAreArtists(presetDrops: PresetDrop[], fetchWithBQ: any) {
  var uniqueArtists = [];
  presetDrops.filter(function (drop) {
    var i = uniqueArtists.findIndex((x) => x.walletAddress == drop.artist.walletAddress);
    if (i <= -1) {
      uniqueArtists.push(drop.artist);
    }
    return null;
  });
  var ok = true;
  for (const artist of uniqueArtists) {
    if (artist.role != Role.ARTIST) {
      toast.error(`Failure: promote ${artist.username} to ARTIST before creating the drop.`)
      ok = false;
    }
  }
  if (!ok) throw new Error();
}

// Runs each deploy step under a named breadcrumb so a failure anywhere in the
// chain reports WHICH step died (and logs the full error), instead of
// surfacing a bare ethers error with no context.
async function deployStep<T>(step: string, run: () => Promise<T>): Promise<T> {
  console.log(`deployDrop() :: ${step}...`);
  const progressId = dropProgress.begin(`Minting on-chain: ${step}`);
  try {
    const result = await run();
    dropProgress.complete(progressId);
    return result;
  } catch (e: any) {
    dropProgress.fail(progressId, extractErrorMessage(e));
    console.error(`deployDrop() :: FAILED at step '${step}'`, e);
    throw new Error(`${step}: ${extractErrorMessage(e)}`);
  }
}

async function deployDrop(dropId: number, signer: Signer, fetchWithBQ: any) {
  await assertSignerOnConfiguredChain(signer);
  const { data: drop } = await fetchWithBQ(`drops?action=GetFullDrop&id=${dropId}`);
  inspectDropGamesEndTimes(drop);
  // HARD GATE: confirm every artwork's media + metadata is actually retrievable
  // on Arweave BEFORE anything is minted on-chain. An Arweave upload can ACK but
  // not persist (mined tx header, unseeded data); without this, a game would be
  // minted on-chain pointing at dead media. If any artwork fails, this throws
  // and NOTHING is deployed on-chain — the drop can be re-uploaded and retried.
  await verifyDropMediaRetrievable(drop);
  //await processSplitter(drop.PrimarySplitter, signer, fetchWithBQ);
  //await processSplitter(drop.SecondarySplitter, signer, fetchWithBQ);
  //await createNftCollection(drop, signer);
  const artistNftContractAddress = await deployStep('artist NFT contract', () =>
    // display name becomes the ERC-721 name of a NEW contract (external
    // marketplaces title the collection with it — never plain 'SAGE')
    fetchOrCreateNftContract(
      drop.artistAddress,
      signer,
      fetchWithBQ,
      (drop as any).artistDisplayName || drop.NftContract?.Artist?.username,
      (drop as any).nftSymbol
    )
  );
  if (artistNftContractAddress == ethers.constants.AddressZero) {
    throw new Error('Unable to deploy a new artist NFT contract');
  }
  // trigger server-side task that optimizes NFT images
  await fetchWithBQ(`drops?action=OptimizeDropImages&id=${dropId}`);
  // Stamp this drop's royalty on the artist contract BEFORE any game deploys,
  // so every token minted for this drop carries it. Legacy artist contracts
  // (pre-royalty code, no setter) log a warning and keep their fixed 12%.
  await deployStep('setting drop royalty', () => setDropRoyalty(drop, artistNftContractAddress, signer));
  // Gated drop? Deploy its SageWhitelist + push the addresses BEFORE the games,
  // so lotteries/open editions can be wired to it at creation. Ungated drops
  // get AddressZero — identical to the pre-allowlist behavior.
  const whitelistAddress = await deployStep('allowlist contract', () =>
    deployAndSyncAllowlist(drop, signer, fetchWithBQ)
  );
  await deployStep('auctions', () =>
    deployAuctions(drop, artistNftContractAddress, signer, fetchWithBQ)
  );
  await deployStep('lotteries', () =>
    deployLotteries(drop, artistNftContractAddress, signer, fetchWithBQ, whitelistAddress)
  );
  await deployStep('open editions', () =>
    deployOpenEditions(drop, artistNftContractAddress, signer, fetchWithBQ, whitelistAddress)
  );
  await deployStep('collection mints', () =>
    deployCollectionMints(drop, artistNftContractAddress, signer, fetchWithBQ, whitelistAddress)
  );
  // FINAL required step: flip approvedAt/isLive so the drop appears on the
  // storefront. This call was dropped in an earlier refactor, which left a
  // fully-minted drop invisible — it must always run after the games deploy
  // (retries internally; throws an actionable message if it still fails).
  await deployStep('marking drop live', () =>
    updateDbApprovedDateAndIsLiveFlags(drop, fetchWithBQ)
  );
  // Warm the media proxy's iOS-safe transcode for every video in the drop, so
  // the first mobile viewer at go-live gets a cache hit. Reported in the log so
  // the admin sees which videos get downscaled. Best-effort: never fails the
  // deploy (the drop already succeeded on-chain), so it's awaited but its
  // errors are swallowed.
  await prewarmDropVideos(drop);
  // Same reasoning applies to plain images (banner, tile, artist icon): an
  // Arweave edge node that hasn't propagated a fresh upload yet 404s it just
  // like an unwarmed video would. Warming here means the FIRST real visitor —
  // not just mobile viewers — gets a cache hit instead of hitting the gap live.
  await prewarmDropImages(drop);
  // Backstop for the S3 display-mirror (upload time already tried this; this
  // catches any that failed then, e.g. a transient network blip).
  await syncMissingS3Mirrors(drop, fetchWithBQ);
}

/**
 * Stamps the drop's royalty (DB percent -> chain bps) as the artist contract's
 * default, so every token minted from now on carries it. Warn-don't-fail on
 * LEGACY artist contracts (pre-royalty code has no setter — their royalty is
 * fixed at 12% and pools in-contract), so existing artists' drops still deploy.
 * Idempotent: skips the tx when the on-chain value already matches.
 */
async function setDropRoyalty(drop: DropFull, artistNftContractAddress: string, signer: Signer) {
  const bps = Math.round(((drop as any).royaltyPercentage ?? 12) * 100);
  const nft = await getNFTContract(artistNftContractAddress, signer);
  let current: number;
  try {
    current = Number(await (nft as any).defaultRoyaltyBps());
  } catch {
    dropProgress.note(
      `Artist contract predates per-drop royalties — royalty stays at the fixed 12% (pooled). ` +
        `Re-onboard the artist under a new contract to use custom royalties.`
    );
    return;
  }
  if (current === bps) {
    console.log(`setDropRoyalty() :: already ${bps} bps, skipping`);
    return;
  }
  console.log(`setDropRoyalty() :: ${current} -> ${bps} bps on ${artistNftContractAddress}`);
  const tx = await (nft as any).setDefaultRoyalty(bps);
  await tx.wait();
}

/**
 * Deploys (or reuses) the drop's SageWhitelist contract and pushes any
 * addresses not yet on-chain, in ALLOWLIST_CHUNK_SIZE batches. Each confirmed
 * chunk is immediately recorded server-side (MarkAllowlistSynced), so an
 * interrupted deploy resumes exactly where it stopped on the next attempt.
 * Ungated/empty allowlists return AddressZero — the no-gate sentinel the
 * contracts already understand.
 */
async function deployAndSyncAllowlist(
  drop: DropFull,
  signer: Signer,
  fetchWithBQ: any
): Promise<string> {
  const { data: allowlist } = await fetchWithBQ(`drops?action=GetDropAllowlist&id=${drop.id}`);
  // An IP-gated drop needs the whitelist contract even with ZERO pre-listed
  // addresses — minters are added one by one as they claim spots.
  const ipGated = Boolean((drop as any).ipGateEnabled);
  if ((!allowlist?.enabled || !allowlist.entries?.length) && !ipGated) {
    return ethers.constants.AddressZero;
  }
  let contractAddress: string = allowlist.whitelistContractAddress;
  if (contractAddress) {
    console.log(`deployAndSyncAllowlist() :: reusing whitelist contract ${contractAddress}`);
  } else {
    console.log(`deployAndSyncAllowlist() :: deploying SageWhitelist for drop ${drop.id}...`);
    const factory = new ethers.ContractFactory(
      sageWhitelistJson.abi,
      sageWhitelistJson.bytecode,
      signer
    );
    const instance = await factory.deploy(parameters.STORAGE_ADDRESS);
    await instance.deployed();
    contractAddress = instance.address;
    console.log(`deployAndSyncAllowlist() :: SageWhitelist deployed to ${contractAddress}`);
    // persist the address even when there are no entries to sync (IP gate)
    await fetchWithBQ({
      url: 'drops?action=MarkAllowlistSynced',
      method: 'POST',
      body: { dropId: drop.id, addresses: [], contractAddress },
    });
  }
  if (allowlist?.entries?.length) {
    await syncAllowlistAddresses(drop.id, contractAddress, allowlist.entries, signer, fetchWithBQ);
  }
  return contractAddress;
}

/**
 * Points every DEPLOYED game of a drop at the given whitelist address
 * (AddressZero = un-gate). Used when gating is enabled or disabled on a drop
 * that's already live; freshly-created games get the address at creation
 * instead. Skips games already pointing at the target, so re-runs are cheap.
 */
async function setGamesWhitelist(drop: DropFull, whitelistAddress: string, signer: Signer) {
  const deployedLotteries = drop.Lotteries.filter((l: any) => l.contractAddress);
  if (deployedLotteries.length) {
    const lotteryContract = await getLotteryContract(signer);
    for (const l of deployedLotteries) {
      const current = await lotteryContract.getWhitelist(l.id);
      if (current?.toLowerCase() === whitelistAddress.toLowerCase()) continue;
      console.log(`setGamesWhitelist() :: lottery ${l.id} -> ${whitelistAddress}`);
      const tx = await lotteryContract.setWhitelist(l.id, whitelistAddress);
      await tx.wait();
    }
  }
  const deployedOEs = drop.OpenEditions.filter((oe: any) => oe.contractAddress);
  if (deployedOEs.length) {
    const openEditionContract = await getOpenEditionContract(signer);
    for (const oe of deployedOEs) {
      const editionId = oe.editionId ?? oe.id;
      const onChain = await openEditionContract.getOpenEdition(editionId);
      if (onChain?.whitelist?.toLowerCase() === whitelistAddress.toLowerCase()) continue;
      console.log(`setGamesWhitelist() :: open edition ${editionId} -> ${whitelistAddress}`);
      const tx = await openEditionContract.setWhitelist(editionId, whitelistAddress);
      await tx.wait();
    }
  }
  // collections were missing here — a live collection drop couldn't be
  // (un)gated post-deploy until the IP-gate work surfaced the gap
  const deployedCollections = (drop.CollectionMints || []).filter((cm: any) => cm.contractAddress);
  for (const cm of deployedCollections) {
    // each row's own contract, not a shared instance fetched once — SageCollection
    // stopped being a strict singleton (2026-07-14 one-tx-deploy switch), so a
    // collection created before that lives on an older contract than any other
    // row here.
    const collectionContract = await getCollectionContract(signer, cm.contractAddress);
    const cId = cm.collectionId ?? cm.id;
    const onChain = await collectionContract.getCollection(cId);
    if (onChain?.whitelist?.toLowerCase() === whitelistAddress.toLowerCase()) continue;
    console.log(`setGamesWhitelist() :: collection ${cId} -> ${whitelistAddress}`);
    const tx = await collectionContract.setWhitelist(cId, whitelistAddress);
    await tx.wait();
  }
}

/** Pushes unsynced allowlist entries on-chain in chunks, marking each chunk synced. */
async function syncAllowlistAddresses(
  dropId: number,
  contractAddress: string,
  entries: { address: string; syncedAt: string | null }[],
  signer: Signer,
  fetchWithBQ: any
) {
  const pending = entries.filter((e) => !e.syncedAt).map((e) => e.address);
  if (pending.length === 0) return;
  const whitelistContract = new ethers.Contract(contractAddress, sageWhitelistJson.abi, signer);
  const batches = chunk(pending, ALLOWLIST_CHUNK_SIZE);
  for (let i = 0; i < batches.length; i++) {
    console.log(
      `syncAllowlistAddresses() :: adding batch ${i + 1}/${batches.length} (${batches[i].length} addresses)...`
    );
    const tx = await whitelistContract.addAddresses(batches[i]);
    await tx.wait();
    // record per-chunk so an interruption resumes at the right batch
    await fetchWithBQ({
      url: 'drops?action=MarkAllowlistSynced',
      method: 'POST',
      body: { dropId, addresses: batches[i], contractAddress },
    });
  }
}

/**
 * Uploads each artwork (media + generated metadata, 2 Arweave txs) and
 * registers its game row on the given drop. Shared by drop CREATION and by
 * "add artworks" on a saved draft — adding to a draft pays only for the NEW
 * files; everything already uploaded stays as-is (Arweave storage is paid
 * once and permanent, so edits must never re-upload existing media).
 */
/** Compress + pin a media file to Filebase via the social uploader. Retries
 *  transient failures (network blip, a 503 under load) — video transcoding
 *  is the heaviest request this server handles, so it's the most exposed
 *  to a momentarily overloaded instance. */
async function uploadFileToFilebase(
  file: File
): Promise<{ url: string; optimizedUrl: string; posterUrl?: string }> {
  return retryTransient(async () => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/social-upload/?kind=nft&pin=1', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      const err: any = new Error(data?.error || 'Filebase upload failed');
      err.status = res.status;
      err.code = data?.code;
      throw err;
    }
    return { url: data.url, optimizedUrl: data.url, posterUrl: data.posterUrl };
  });
}

/** Pin ERC-721 metadata JSON to Filebase; returns the gateway URL. Retries
 *  transient failures, same reasoning as uploadFileToFilebase above. */
async function pinMetadataToFilebase(
  name: string,
  description: string,
  mediaUrl: string,
  isVideo: boolean,
  posterUrl?: string
): Promise<string> {
  return retryTransient(async () => {
    const res = await fetch('/api/endpoints/dropUpload/?action=PinNftMetadataToFilebase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description,
        // ERC-721 convention: `image` is a static preview (marketplaces/
        // wallets that only render <img> read this), `animation_url` is the
        // real playable media. Without a poster, video drops shipped the
        // raw .mp4 as `image` too — broken everywhere but SAGE's own player.
        image: isVideo && posterUrl ? posterUrl : mediaUrl,
        animationUrl: isVideo ? mediaUrl : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      const err: any = new Error(data?.error || 'metadata pin failed');
      err.status = res.status;
      throw err;
    }
    return data.url;
  });
}

async function uploadAndRegisterArtworks(
  dropId: number,
  artworks: NewDropArtwork[],
  startDate: number,
  endDate: number,
  fetchWithBQ: any,
  storage: 'arweave' | 'filebase' = 'arweave'
) {
  const endpoint = '/api/endpoints/dropUpload/';
  const total = artworks.length;
  for (let i = 0; i < total; i++) {
    const artwork = artworks[i];
    const label = artwork.name || `artwork ${i + 1}`;
    const { url, optimizedUrl, posterUrl } = await dropProgress.track(
      `Uploading "${label}" to ${storage === 'filebase' ? 'Filebase (IPFS)' : 'Arweave'} (${i + 1}/${total})`,
      () => (storage === 'filebase' ? uploadFileToFilebase(artwork.file) : uploadFileToArweave(artwork.file))
    );
    const { width, height } = await getMediaDimensions(artwork.file);
    // Build the ERC-721 metadata JSON and store it on Arweave; its URL
    // becomes the on-chain tokenURI when the drop is deployed. Without
    // this, minted NFTs would have a null/blank metadata pointer.
    const isVideo = artwork.file.type === 'video/mp4';
    const metadataPath = await dropProgress.track(
      `Writing metadata for "${label}"`,
      () =>
        storage === 'filebase'
          ? pinMetadataToFilebase(artwork.name, artwork.description, url, isVideo, posterUrl)
          : createNftMetadataOnArweave(endpoint, artwork.name, artwork.description, url, isVideo)
    );
    const media = {
      name: artwork.name,
      description: artwork.description,
      arweavePath: url,
      metadataPath,
      s3Path: url,
      s3PathOptimized: optimizedUrl,
      // Real media stays in s3Path/s3PathOptimized (BaseMedia can actually
      // play a video) — this just tells it that's safe, since a Filebase/
      // IPFS URL has no extension for isVideoSrc to sniff (see
      // BaseMedia.tsx / Nft.mediaType).
      mediaType: isVideo ? 'video' : 'image',
      width,
      height,
    };
    const saleLabel =
      artwork.saleType === 'auction'
        ? 'auction'
        : artwork.saleType === 'lottery'
        ? 'drawing'
        : 'open edition';
    await dropProgress.track(`Registering ${saleLabel} for "${label}"`, async () => {
      if (artwork.saleType === 'auction') {
        const { data: result } = await fetchWithBQ({
          url: 'endpoints/dropUpload?action=InsertAuction',
          method: 'POST',
          body: { dropId, minPrice: String(artwork.minPrice), startDate, endDate, ...media },
        });
        if ((result as any)?.error) throw new Error((result as any).error);
      } else if (artwork.saleType === 'lottery') {
        const { data: drawingResult } = await fetchWithBQ({
          url: 'endpoints/dropUpload?action=InsertDrawing',
          method: 'POST',
          body: {
            dropId,
            ticketCostTokens: artwork.ticketCostTokens,
            ticketCostPoints: artwork.ticketCostPoints,
            maxTickets: artwork.maxTickets,
            maxTicketsPerUser: artwork.maxTicketsPerUser,
            startDate,
            endDate,
            isRefundable: 'false',
          },
        });
        if ((drawingResult as any)?.error) throw new Error((drawingResult as any).error);
        const drawingId = (drawingResult as any).drawingId as number;
        const { data: nftResult } = await fetchWithBQ({
          url: 'endpoints/dropUpload?action=InsertNft',
          method: 'POST',
          body: { drawingId, numberOfEditions: 1, ...media },
        });
        if ((nftResult as any)?.error) throw new Error((nftResult as any).error);
      } else {
        const { data: result } = await fetchWithBQ({
          url: 'endpoints/dropUpload?action=InsertOpenEdition',
          method: 'POST',
          body: {
            dropId,
            costTokens: artwork.costTokens,
            costPoints: artwork.costPoints,
            maxPerUser: artwork.maxPerUser,
            startDate,
            endDate,
            ...media,
          },
        });
        if ((result as any)?.error) throw new Error((result as any).error);
      }
    });
  }
}

/**
 * Collection-drop creation pipeline (client side): registers the game row,
 * stages the ZIP on S3 (the browser must PUT it there itself — Cloud Run's
 * edge rejects >32MB request bodies, so the zip can't travel through our own
 * API), then kicks the server's long-running bundling job and mirrors its
 * DB-reported progress into the dashboard log until it completes.
 */
async function runCollectionPipeline(
  dropId: number,
  req: CreateDropRequest,
  startDate: number,
  endDate: number,
  fetchWithBQ: any
) {
  const c = req.collection!;
  const { data: cmResult } = await dropProgress.track('Registering collection', async () =>
    fetchWithBQ({
      url: 'endpoints/dropUpload?action=InsertCollectionMint',
      method: 'POST',
      body: {
        dropId,
        costTokens: c.costTokens,
        limitPerUser: c.limitPerUser,
        startDate,
        // no duration = no deadline: the mint stays open until sold out
        endDate: c.durationHours ? startDate + c.durationHours * 3600 : null,
        nftSymbol: req.nftSymbol,
      },
    })
  );
  if ((cmResult as any)?.error) throw new Error((cmResult as any).error);
  const collectionMintId = (cmResult as any).collectionMintId as number;

  const zipMB = (c.zipFile.size / (1024 * 1024)).toFixed(0);
  await dropProgress.track(`Staging zip on S3 (${zipMB}MB)`, () =>
    uploadFileToS3(
      '/api/endpoints/dropUpload/',
      'collection-staging',
      `${collectionMintId}.zip`,
      c.zipFile
    )
  );

  // Long-running server job. The kickoff request is FIRE-AND-FORGET and the
  // DB status poll is the source of truth for completion: Cloudflare cuts
  // origin responses at ~100s, so awaiting the request itself made any zip
  // that outlives that look like a failure in the dashboard while the server
  // (which keeps running after the client disconnects, and checkpoints its
  // work) actually finished fine — same shape as the 2026-07-12 "rMonet"
  // banner-upload timeout.
  const stepId = dropProgress.begin(
    req.storage === 'filebase'
      ? 'Pinning images to Filebase/IPFS (this can take a while)'
      : 'Bundling images to Arweave (this can take a while)'
  );
  // kickoff: swallow transport errors — the status poll decides success/failure
  fetch(
    `/api/endpoints/dropUpload/?action=ProcessCollectionZip&id=${collectionMintId}&storage=${
      req.storage || 'arweave'
    }`
  ).catch(() => {});
  try {
    // Poll until the job reports a terminal status. No client-side deadline —
    // thousands-of-images zips legitimately take a long time, and the server
    // marks status 'failed' (reason in progress.error) on any hard stop.
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      let cm: any;
      try {
        const { data } = await fetchWithBQ(
          `endpoints/dropUpload?action=GetCollectionStatus&id=${collectionMintId}`
        );
        cm = data;
      } catch {
        continue; // transient poll failure — keep waiting
      }
      const progress = cm?.progress ? JSON.parse(cm.progress) : null;
      if (cm?.status === 'done') {
        dropProgress.complete(
          stepId,
          `${cm.maxSupply} images live — manifest ${String(cm.manifestId).slice(0, 8)}…`
        );
        return;
      }
      if (cm?.status === 'failed') {
        throw new Error(progress?.error || 'processing failed — see server logs');
      }
      if (progress?.imagesTotal) {
        dropProgress.update(
          stepId,
          `${progress.imagesBundled ?? 0}/${progress.imagesTotal} images bundled, ` +
            `${progress.bundlesPosted?.length ?? 0} bundle tx${(progress.bundlesPosted?.length ?? 0) === 1 ? '' : 's'} posted`
        );
      }
    }
  } catch (e: any) {
    dropProgress.fail(stepId, e?.message);
    throw e;
  }
}

/**
 * Creates the drop's collections on the SageCollection singleton. Idempotent
 * like the other game deploys: rows with a contractAddress are skipped, so a
 * re-approve resumes cleanly. Requires zip processing to have finished (the
 * baseUri/maxSupply come from it) — an unprocessed collection fails the step.
 *
 * One wallet confirmation per collection: createCollectionWithNewNft deploys
 * the DEDICATED per-drop NFT contract (named after the drop — external
 * marketplaces title a collection by ERC-721 name(), so minting into the
 * artist's shared contract made every drop surface under one collection) AND
 * registers the collection against it, both in a single on-chain tx, with the
 * royalty and (for social drops) the artist-share split stamped in the same
 * call instead of two follow-up setter transactions.
 */
async function deployCollectionMints(
  drop: DropFull,
  artistNftContractAddress: string,
  signer: Signer,
  fetchWithBQ: any,
  whitelistAddress: string
) {
  if (!drop.CollectionMints || drop.CollectionMints.length === 0) return;
  const contract = await getCollectionContract(signer);
  for (const cm of drop.CollectionMints) {
    if (cm.contractAddress) continue; // already deployed
    if (cm.status !== 'done' || !cm.baseUri || !cm.maxSupply) {
      throw new Error(
        `Collection #${cm.id} hasn't finished processing its zip (status: ${cm.status}) — ` +
          `wait for processing to complete (or re-run it from the create form) and re-approve.`
      );
    }
    const collectionStruct = {
      startTime: Math.floor(new Date(cm.startTime).getTime() / 1000),
      // null endTime -> closeTime 0 = no deadline, open until sold out
      closeTime: cm.endTime ? Math.floor(new Date(cm.endTime).getTime() / 1000) : 0,
      maxSupply: cm.maxSupply,
      mintCount: 0,
      limitPerUser: cm.limitPerUser,
      baseUri: cm.baseUri,
      whitelist: whitelistAddress,
      costTokens: ethers.utils.parseEther(toDecimalString(cm.costTokens)),
      id: cm.id,
      currency: currencyAddressFor((drop as any).currency),
      artistShareBps: (drop as any).isSocial ? SOCIAL_ARTIST_SHARE_BPS : 0,
    };

    let nftContractAddress = (cm as any).nftContractAddress;
    if (!nftContractAddress) {
      const customSymbol = (cm as any).nftSymbol?.trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
      const symbol =
        customSymbol || drop.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'SAGE';
      const bps = Math.round(((drop as any).royaltyPercentage ?? 12) * 100);
      console.log(`deployCollectionMints() :: deploying "${drop.name}" (${symbol}) NFT contract + creating collection #${cm.id} in one tx…`);
      const tx = await contract.createCollectionWithNewNft(
        { name: drop.name, symbol, artistShare: 8333, royaltyBps: bps },
        { ...collectionStruct, nftContract: ethers.constants.AddressZero }
      );
      const receipt = await tx.wait();
      const created = receipt.events?.find((e: any) => e.event === 'CollectionCreated');
      nftContractAddress = created?.args?.nftContract;
      if (!nftContractAddress) {
        throw new Error(`Collection #${cm.id}: couldn't read the deployed NFT contract address from the transaction receipt.`);
      }
      // persist + server sets contractURI (needs the platform key's
      // storage DEFAULT_ADMIN — a dashboard admin wallet would revert)
      const { data: saved } = await fetchWithBQ(
        `drops?action=UpdateCollectionNftContract&id=${cm.id}&address=${nftContractAddress}`
      );
      if ((saved as any)?.error) throw new Error((saved as any).error);
      console.log(`deployCollectionMints() :: dedicated NFT contract ${nftContractAddress}`);
    } else {
      // Resume path: an earlier partial run already deployed the dedicated
      // NFT contract (e.g. the process crashed between steps) — fall back to
      // registering the collection against that existing contract directly.
      // Idempotency check: cm.id (a DB auto-increment id, not scoped per
      // contract) is reused as the ON-CHAIN collection id on every retry.
      // createCollection() reverts "Collection already exists" if it's
      // already registered — which happens whenever the tx itself succeeded
      // but a LATER step in this same function (recording contractAddress
      // below) threw, leaving contractAddress null in the DB forever while
      // the on-chain collection is real. Checking on-chain state first makes
      // a retry pick up where it actually left off instead.
      const existing = await contract.getCollection(cm.id);
      if (existing.startTime > 0) {
        console.log(`deployCollectionMints() :: collection #${cm.id} already exists on-chain, skipping createCollection`);
      } else {
        const tx = await contract.createCollection({ ...collectionStruct, nftContract: nftContractAddress });
        await tx.wait();
      }
    }
    const { data: updated } = await fetchWithBQ(
      `drops?action=UpdateCollectionContractAddress&id=${cm.id}&address=${parameters.COLLECTION_ADDRESS}`
    );
    if ((updated as any)?.error) throw new Error((updated as any).error);
  }
}

/** extract a 43-char Arweave txid from an arweave.net URL, or null */
function arweaveTxid(url?: string | null): string | null {
  const m = url ? /arweave\.net\/([A-Za-z0-9_-]{43})/.exec(url) : null;
  return m ? m[1] : null;
}

/**
 * Pre-mint gate: verifies every artwork's media AND metadata is actually
 * retrievable from Arweave before the drop is deployed on-chain. Throws — naming
 * the specific asset (the video/image vs the metadata) and the HTTP reason — if
 * any isn't, so a game is never minted pointing at dead data. Checks route
 * through our /api/media proxy's resilient, retried existence check rather than
 * a single arweave.net node, so a transient gateway 404 doesn't false-fail a
 * good upload. Reported per-artwork in the dashboard log.
 */
async function verifyDropMediaRetrievable(drop: DropFull) {
  // Collection drops: verify the manifest + spot-check the FIRST and LAST
  // token's metadata items (not all 5,000 — keeps the gate bounded; the
  // bundles are all-or-nothing txs, so the ends existing is strong evidence
  // the middle does too). Freshly-bundled DataItems can lag gateway indexing
  // even longer than plain txs; the S3 mirror covers display meanwhile, but
  // the on-chain tokenURI depends on Arweave — so the gate stays strict.
  for (const cm of drop.CollectionMints ?? []) {
    if (cm.contractAddress) continue; // already deployed in a previous run
    // Filebase collections (isSocial) never get a manifestId — that's an
    // Arweave-bundle concept, and processCollectionZipToFilebase() only ever
    // sets baseUri/pathMap. Requiring it here made every healthy, fully-"done"
    // Filebase ZIP collection look unprocessed and block the deploy forever.
    const isFilebase = !!(drop as any).isSocial;
    if (cm.status !== 'done' || !cm.pathMap || (!isFilebase && !cm.manifestId)) {
      throw new Error(
        `Collection #${cm.id} hasn't finished processing (status: ${cm.status}) — nothing was minted on-chain.`
      );
    }
    const map = JSON.parse(cm.pathMap);
    if (isFilebase) {
      // Filebase pins are immediately retrievable (no Arweave-style gateway
      // propagation lag) — a HEAD on the preview image is enough of a sanity
      // check; the txid-oriented verifier below doesn't apply to IPFS URLs.
      await dropProgress.track(`Verifying collection pinned to Filebase`, async () => {
        const firstImg = map['1']?.img;
        if (!firstImg) return;
        const res = await fetch(firstImg, { method: 'HEAD' }).catch(() => null);
        if (!res || !res.ok) {
          throw new Error(
            `The first image isn't retrievable from Filebase yet (${res ? `HTTP ${res.status}` : 'network error'}). ` +
              `Nothing was minted on-chain — re-approve in a moment.`
          );
        }
      });
      continue;
    }
    const checks = [
      { label: 'collection manifest', txid: cm.manifestId },
      { label: 'first token metadata', txid: map['1']?.json },
      { label: `last token metadata (#${cm.maxSupply})`, txid: map[String(cm.maxSupply)]?.json },
      { label: 'first image', txid: map['1']?.img },
    ].filter((c): c is { label: string; txid: string } => !!c.txid);
    await dropProgress.track(`Verifying collection uploaded to Arweave`, async () => {
      for (const check of checks) {
        const result = await verifyAssetRetrievable(check.txid);
        console.log(
          `verifyDropMedia() :: collection ${check.label} ${check.txid} -> ` +
            (result.retrievable ? 'OK' : `NOT retrievable (${result.reason})`)
        );
        if (!result.retrievable) {
          throw new Error(
            `The ${check.label} isn't retrievable on Arweave yet (${result.reason}). ` +
              `Freshly-bundled uploads can take a while to index — nothing was minted ` +
              `on-chain; use "verify assets" on the New Drops tab and re-approve once green.`
          );
        }
      }
    });
  }
  const nfts = [
    ...drop.Auctions.map((a) => a.Nft),
    ...drop.Lotteries.flatMap((l) => l.Nfts),
    ...drop.OpenEditions.map((oe) => oe.Nft),
  ].filter(Boolean);
  for (const nft of nfts) {
    const name = nft?.name || 'artwork';
    const assets = [
      { label: nft?.arweavePath?.includes('filetype=mp4') ? 'video' : 'image', txid: arweaveTxid(nft?.arweavePath) },
      { label: 'metadata', txid: arweaveTxid(nft?.metadataPath) },
    ].filter((a): a is { label: string; txid: string } => !!a.txid);
    await dropProgress.track(`Verifying "${name}" uploaded to Arweave`, async () => {
      for (const asset of assets) {
        const result = await verifyAssetRetrievable(asset.txid);
        console.log(
          `verifyDropMedia() :: "${name}" ${asset.label} ${asset.txid} -> ` +
            (result.retrievable ? 'OK' : `NOT retrievable (${result.reason})`)
        );
        if (!result.retrievable) {
          throw new Error(
            `"${name}" — the ${asset.label} isn't retrievable on Arweave (${result.reason}). ` +
              `Its upload didn't fully persist. Nothing was minted on-chain; ` +
              `re-upload this artwork and try again.`
          );
        }
      }
    });
  }
}

/** resilient existence check via the proxy (retries the gateway server-side) */
async function verifyAssetRetrievable(
  txid: string
): Promise<{ retrievable: boolean; reason?: string }> {
  try {
    const res = await fetch(`/api/media/${txid}/?verify=1`);
    if (!res.ok) return { retrievable: false, reason: `verify HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { retrievable: !!data.retrievable, reason: data.reason };
  } catch (e: any) {
    return { retrievable: false, reason: e?.message || 'verify request failed' };
  }
}

/**
 * Prewarm + report the mobile downscale for each video NFT in a drop. Each
 * video becomes a tracked step so the dashboard log shows whether it was
 * downscaled (and from/to dimensions). Server-side transcodes are serialized,
 * so a video that needs one shows an active spinner until it's ready.
 */
async function prewarmDropVideos(drop: DropFull) {
  try {
    const nfts = [
      ...drop.Auctions.map((a) => a.Nft),
      ...drop.Lotteries.flatMap((l) => l.Nfts),
      ...drop.OpenEditions.map((oe) => oe.Nft),
    ];
    const seen = new Set<string>();
    const videos: { name: string; txid: string }[] = [];
    for (const nft of nfts) {
      const src = nft?.s3PathOptimized;
      if (!src || !isVideoSrc(src)) continue;
      const m = /arweave\.net\/([A-Za-z0-9_-]{43})/.exec(src);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        videos.push({ name: nft.name || 'artwork', txid: m[1] });
      }
    }
    if (videos.length === 0) return;
    await Promise.allSettled(videos.map(prewarmOneVideo));
  } catch (e) {
    console.log('prewarmDropVideos() skipped', e);
  }
}

/**
 * Warms the drop's plain images (banner/tile/featured/mobile-cover + the
 * artist's icon) through the media proxy. Unlike video, these never need a
 * transcode — the prewarm just forces the proxy's gateway-retry-with-backoff
 * to run server-side, ahead of any real visitor. Silent best-effort: an image
 * still propagating just means a (rare, temporary) broken image on first
 * view, not a failed deploy — no dropProgress step, to avoid alarming the
 * admin over something that self-heals.
 */
async function prewarmDropImages(drop: DropFull) {
  try {
    const candidates = [
      drop.bannerImageS3Path,
      drop.tileImageS3Path,
      drop.featuredMediaS3Path,
      drop.mobileCoverS3Path,
      drop.NftContract?.Artist?.profilePicture,
    ];
    const seen = new Set<string>();
    const txids: string[] = [];
    for (const src of candidates) {
      const m = src && /arweave\.net\/([A-Za-z0-9_-]{43})/.exec(src);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        txids.push(m[1]);
      }
    }
    await Promise.allSettled(
      txids.map((txid) =>
        fetch(`/api/media/${txid}/?prewarm=1`).catch(() => {
          /* proxy will retry again on first real view */
        })
      )
    );
  } catch (e) {
    console.log('prewarmDropImages() skipped', e);
  }
}

/**
 * Deploy-time backstop for the S3 display-mirror (src/utilities/s3Mirror.ts):
 * re-syncs any video/image whose upload-time mirror write failed, over the
 * same txid set prewarmDropVideos/prewarmDropImages already warm. Silent
 * best-effort, exactly like prewarmDropImages — a missing mirror doesn't
 * block or alarm over a deploy that already succeeded on-chain.
 */
async function syncMissingS3Mirrors(drop: DropFull, fetchWithBQ: any) {
  try {
    const nfts = [
      ...drop.Auctions.map((a) => a.Nft),
      ...drop.Lotteries.flatMap((l) => l.Nfts),
      ...drop.OpenEditions.map((oe) => oe.Nft),
    ];
    const candidates = [
      ...nfts.map((nft) => nft?.s3PathOptimized),
      drop.bannerImageS3Path,
      drop.tileImageS3Path,
      drop.featuredMediaS3Path,
      drop.mobileCoverS3Path,
      drop.NftContract?.Artist?.profilePicture,
    ];
    const seen = new Set<string>();
    const txids: string[] = [];
    for (const src of candidates) {
      const txid = arweaveTxid(src);
      if (txid && !seen.has(txid)) {
        seen.add(txid);
        txids.push(txid);
      }
    }
    await Promise.allSettled(
      txids.map((txid) => fetchWithBQ(`endpoints/dropUpload?action=EnsureS3Mirror&txid=${txid}`))
    );
  } catch (e) {
    console.log('syncMissingS3Mirrors() skipped', e);
  }
}

async function prewarmOneVideo({ name, txid }: { name: string; txid: string }) {
  const stepId = dropProgress.begin(`Preparing "${name}" for mobile playback`);
  // give a slow first-time transcode room to finish, but don't hang forever
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  try {
    const res = await fetch(`/api/media/${txid}/?prewarm=1`, { signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.warmed) {
      // the proxy couldn't retrieve the master from Arweave. Usually the
      // upload's data chunks didn't fully seed (a mined tx header with missing
      // data) — a broken artwork that must be re-uploaded. Occasionally it's
      // just slow gateway propagation of a good upload. Flag it either way so
      // it isn't silently shipped (this is exactly how a bad upload used to
      // only surface later on mobile).
      dropProgress.fail(
        stepId,
        `media not retrievable from Arweave (${data?.error || res.status}). ` +
          `If it doesn't appear within a few minutes, re-upload this artwork.`
      );
      return;
    }
    if (data.downscaled) {
      dropProgress.complete(stepId, `downscaled ${data.from} → ${data.to} for mobile`);
    } else {
      dropProgress.complete(stepId, 'already mobile-ready — no downscale needed');
    }
  } catch {
    // network/timeout on our own endpoint — the proxy will retry on first view
    dropProgress.complete(stepId, 'still optimizing in the background — safe to close');
  } finally {
    clearTimeout(timer);
  }
}

function inspectDropGamesEndTimes(drop: DropFull) {
  const now = Math.floor(Date.now() / 1000);
  const games = new Array().concat(drop.Auctions, drop.Lotteries);
  for (var game of games) {
    const endTime = Math.floor(new Date(game.endTime).getTime() / 1000);
    if (endTime < now && !game.contractAddress) {
      const errMsg = 'One or more games have already ended; please fix dates and try again.';
      toast.warn(errMsg);
      throw new Error(errMsg);
    }
  }
}

async function processSplitter(
  splitter: Splitter_include_Entries,
  signer: Signer,
  fetchWithBQ: any
) {
  if (!splitter) {
    return;
  }
  if (!splitter.splitterAddress) {
    // reuse existing deployed splitters with matching entries (percents & destinations)
    const queryUrl = `drops?action=FindSplitterAddress&id=${splitter.id}`;
    const { data: matchingSplitters } = await fetchWithBQ(queryUrl);
    if (matchingSplitters.length > 0) {
      console.log(`processSplitter() :: Found existing matching splitter!`);
      splitter.splitterAddress = matchingSplitters[0].splitterAddress;
    } else {
      console.log(`processSplitter() :: Deploying new splitter contract...`);
      splitter.splitterAddress = await deploySplitter(splitter, signer);
    }
    if (splitter.splitterAddress) {
      const params = `id=${splitter.id}&address=${splitter.splitterAddress}`;
      await fetchWithBQ(`drops?action=UpdateSplitterAddress&${params}`);
    }
  }
}

async function deploySplitter(splitter: Splitter_include_Entries, signer: Signer): Promise<string> {
  let splitterAddress: string;
  if (splitter.SplitterEntries.length == 1) {
    console.log(`deploySplitter() :: Only one destination address found, no splitter needed.`);
    splitterAddress = splitter.SplitterEntries[0].destinationAddress;
  } else {
    console.log(`deploySplitter() :: Deploying splitter...`);
    let destinations = new Array();
    let weights = new Array();
    for (var i = 0; i < splitter.SplitterEntries.length; i++) {
      destinations.push(splitter.SplitterEntries[i].destinationAddress);
      weights.push(Math.floor(splitter.SplitterEntries[i].percent * 100)); // royalty percentage using basis points. 1% = 100
    }
    const contractFactory = new ethers.ContractFactory(
      splitterContractJson.abi,
      splitterContractJson.bytecode,
      signer
    );
    const contractInstance = await contractFactory.deploy(
      signer.getAddress(),
      destinations,
      weights
    );
    splitterAddress = contractInstance.address;
    console.log(`deploySplitter() :: Splitter deployed to ${splitterAddress}`);
  }
  return splitterAddress;
}

async function createNftCollection(drop: DropFull, signer: Signer) {
  // const nftContract = await getNFTContract(signer);
  // const collectionExists = await nftContract.collectionExists(drop.id);
  // if (collectionExists) {
  //   console.log(`createNftCollection() :: Collection already exists for drop ${drop.id}`);
  //   return;
  // }
  // const royaltyAddress = drop.secondarySplitterId
  //   ? drop.SecondarySplitter?.splitterAddress
  //   : drop.artistAddress;
  // const primarySalesDestination = drop.primarySplitterId
  //   ? drop.PrimarySplitter?.splitterAddress
  //   : drop.artistAddress;
  // // percentage in basis points (2.00% = 200)
  // const royaltyPercentageBasisPoints = Math.floor(drop.royaltyPercentage * 100);
  // const dropBaseUrl = `https://arweave.net/${drop.dropMetadataCid}/`;
  // console.log(
  //   `NFTContract.createCollection(${drop.id}, ${royaltyAddress}, ${royaltyPercentageBasisPoints}, ${dropBaseUrl}, ${primarySalesDestination})`
  // );
  // const tx = await nftContract.createCollection(
  //   drop.id,
  //   royaltyAddress!,
  //   royaltyPercentageBasisPoints,
  //   dropBaseUrl,
  //   primarySalesDestination!
  // );
  // await tx.wait();
  // console.log('createNftCollection() :: Collection created');
}

async function deployAuctions(
  drop: DropFull,
  artistNftContractAddress: string,
  signer: Signer,
  fetchWithBQ: any
) {
  const auctionContract = await getAuctionContract(signer);
  const createParams = [];
  for (const auction of drop.Auctions) {
    if (auction.contractAddress) {
      console.log(
        `deployAuctions() :: ${auction.id} has already been deployed to ${auction.contractAddress}`
      );
      continue;
    }
    const startTime = Math.floor(new Date(auction.startTime).getTime() / 1000);
    const endTime = Math.floor(new Date(auction.endTime).getTime() / 1000);
    const minimumPrice = ethers.utils.parseEther(auction.minimumPrice!);
    createParams.push({
      auctionId: auction.id,
      nftId: auction.nftId,
      minimumPrice,
      startTime,
      endTime: 0,
      // the auction contract starts its clock at the FIRST BID (endTime 0 +
      // duration); honor the sale duration picked in the dashboard instead of
      // a hardcoded 24h — DB start/end times encode that choice
      duration: Math.max(endTime - startTime, 3600),
      nftContract: artistNftContractAddress,
      nftUri: auction.Nft.metadataPath,
      settled: false,
      highestBid: 0,
      highestBidder: ethers.constants.AddressZero,
    });
  }
  if (createParams.length > 0) {
    console.log(`deployAuctions() :: Deploying batch of ${createParams.length}...`);
    if (isEthCurrency((drop as any).currency)) {
      // ETH drops stamp the native-currency sentinel per auction — there is
      // no batch variant of createAuctionWithCurrency, so create one by one
      for (const p of createParams) {
        const tx = await auctionContract.createAuctionWithCurrency(
          p,
          currencyAddressFor('ETH')
        );
        await tx.wait();
      }
    } else {
      const tx = await auctionContract.createAuctionBatch(createParams);
      await tx.wait();
    }
    for (const { auctionId } of createParams) {
      const params = `id=${auctionId}&address=${auctionContract.address}`;
      await fetchWithBQ(`drops?action=UpdateAuctionContractAddress&${params}`);
    }
    // Social launches get the platform's social rate (99% artist / 1%
    // platform) instead of the shared marketplace default — stamped
    // per-auction right after creation so a later change to the marketplace
    // dial can never drift a social creator's split.
    if ((drop as any).isSocial) {
      for (const { auctionId } of createParams) {
        try {
          const tx = await auctionContract.setAuctionArtistShare(auctionId, SOCIAL_ARTIST_SHARE_BPS);
          await tx.wait();
        } catch (e) {
          console.warn(`deployAuctions() :: could not apply the social rate to auction ${auctionId} — it keeps the marketplace default`, e);
        }
      }
    }
  }
}

async function deployLotteries(
  drop: DropFull,
  artistNftContractAddress: string,
  signer: Signer,
  fetchWithBQ: any,
  whitelistAddress: string = ethers.constants.AddressZero
) {
  const createParams = [];
  for (const l of drop.Lotteries) {
    if (l.contractAddress) {
      console.log(`deployLotteries() :: ${l.id} has already been deployed to ${l.contractAddress}`);
      continue;
    }
    const startTime = Math.floor(new Date(l.startTime).getTime() / 1000);
    const endTime = Math.floor(new Date(l.endTime).getTime() / 1000);
    const costPerTicketTokens = ethers.utils.parseEther(toDecimalString(l.costPerTicketTokens));
    createParams.push({
      lotteryID: l.id,
      ticketCostPoints: l.costPerTicketPoints,
      ticketCostTokens: costPerTicketTokens,
      startTime,
      closeTime: endTime,
      nftContract: artistNftContractAddress,
      maxTickets: l.maxTickets || 0,
      maxTicketsPerUser: l.maxTicketsPerUser || 0,
      numberOfEditions: l.Nfts[0].numberOfEditions,
      participantsCount: 0,
      numberOfTicketsSold: 0,
      status: 0, // Status.Created
    });
  }
  if (createParams.length > 0) {
    console.log(`deployLotteries() :: Deploying batch of ${createParams.length}...`);
    const lotteryContract = await getLotteryContract(signer);
    if (isEthCurrency((drop as any).currency)) {
      // ETH drops stamp the native-currency sentinel per lottery — no batch
      // variant of createLotteryWithCurrency, so create one by one
      for (const p of createParams) {
        const tx = await lotteryContract.createLotteryWithCurrency(
          p,
          currencyAddressFor('ETH')
        );
        await tx.wait();
      }
    } else {
      const tx = await lotteryContract.createLotteryBatch(createParams);
      await tx.wait();
    }
    for (const { lotteryID } of createParams) {
      const params = `id=${lotteryID}&address=${lotteryContract.address}`;
      await fetchWithBQ(`drops?action=UpdateLotteryContractAddress&${params}`);
    }
  }
  // Gate pass — separate from the create loop above on purpose: LotteryInfo has
  // no whitelist field, so gating needs a setWhitelist call per lottery. Iterate
  // ALL of the drop's lotteries (not just freshly-created ones) and skip those
  // already pointed at the contract, so a re-run after an interruption wires
  // lotteries the create loop skipped.
  if (whitelistAddress !== ethers.constants.AddressZero) {
    const lotteryContract = await getLotteryContract(signer);
    for (const l of drop.Lotteries) {
      const current = await lotteryContract.getWhitelist(l.id);
      if (current?.toLowerCase() === whitelistAddress.toLowerCase()) continue;
      console.log(`deployLotteries() :: setWhitelist(${l.id}, ${whitelistAddress})`);
      const wtx = await lotteryContract.setWhitelist(l.id, whitelistAddress);
      await wtx.wait();
    }
  }
}

async function deployOpenEditions(
  drop: DropFull,
  artistNftContractAddress: string,
  signer: Signer,
  fetchWithBQ: any,
  whitelistAddress: string = ethers.constants.AddressZero
) {
  const toDeploy = drop.OpenEditions.filter((oe) => !oe.contractAddress);
  if (toDeploy.length === 0) return;
  console.log(`deployOpenEditions() :: Deploying ${toDeploy.length} open edition(s)...`);
  const openEditionContract = await getOpenEditionContract(signer);
  for (const oe of toDeploy) {
    const startTime = Math.floor(new Date(oe.startTime).getTime() / 1000);
    const closeTime = Math.floor(new Date(oe.endTime).getTime() / 1000);
    const costTokens = ethers.utils.parseEther(toDecimalString(oe.costTokens));
    // Idempotency check: oe.id (a DB id) is reused as the on-chain edition
    // id on every retry. createOpenEdition() reverts "Edition already
    // exists" if it's already registered — which happens whenever the tx
    // itself succeeded but the UpdateOpenEditionContractAddress call (or
    // the artist-share call) below threw, leaving contractAddress null in
    // the DB forever while the on-chain edition is real. See the matching
    // check in deployCollectionMints for the full story.
    const existingOe = await openEditionContract.getOpenEdition(oe.id);
    if (existingOe.startTime > 0) {
      console.log(`deployOpenEditions() :: edition #${oe.id} already exists on-chain, skipping createOpenEdition`);
    } else {
      // on-chain struct id == this row's DB id, so UpdateOpenEditionContractAddress
      // can set editionId = id (see drops.page.ts)
      const tx = await openEditionContract.createOpenEdition({
        id: oe.id,
        startTime,
        closeTime,
        costPoints: oe.costPoints,
        limitPerUser: oe.maxPerUser,
        mintCount: 0,
        nftUri: oe.Nft.metadataPath,
        nftContract: artistNftContractAddress,
        // AddressZero = ungated; a gated drop passes its SageWhitelist so the
        // contract enforces the allowlist on every mint path
        whitelist: whitelistAddress,
        costTokens,
        currency: currencyAddressFor((drop as any).currency),
      });
      await tx.wait();
    }
    const params = `id=${oe.id}&address=${openEditionContract.address}`;
    await fetchWithBQ(`drops?action=UpdateOpenEditionContractAddress&${params}`);
    if ((drop as any).isSocial) {
      try {
        const stx = await openEditionContract.setEditionArtistShare(oe.id, SOCIAL_ARTIST_SHARE_BPS);
        await stx.wait();
      } catch (e) {
        console.warn(`deployOpenEditions() :: could not apply the social rate to edition ${oe.id} — it keeps the marketplace default`, e);
      }
    }
  }
}

/** Measures an image file client-side; videos and unmeasurable files return nulls. */
async function getMediaDimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  if (!file.type.startsWith('image/')) {
    return { width: null, height: null };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return { width: null, height: null };
  }
}

async function updateDbApprovedDateAndIsLiveFlags(drop: DropFull, fetchWithBQ: any): Promise<Date> {
  // This is the FINAL step, run AFTER the games are already minted on-chain. If
  // it fails, the drop is minted but never marked live — invisible on the
  // storefront with no auto-recovery (exactly what stranded a drop once). Retry
  // so a transient failure on this last flag update doesn't strand the drop.
  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetchWithBQ(`drops?action=UpdateApprovedDateAndIsLiveFlags&id=${drop.id}`);
    // accept both response shapes: { approvedAt } (current) and the bare date
    // (pre-rev-31 servers) — the mismatch once made SUCCESSFUL approvals look
    // failed and surfaced a bogus "re-approve" error after a clean deploy
    const approvedAt = res?.data?.approvedAt ?? (typeof res?.data === 'string' ? res.data : null);
    if (approvedAt) return approvedAt;
    lastErr = (res?.error && JSON.stringify(res.error)) || 'no approvedAt returned';
    console.warn(`approval-flags attempt ${attempt + 1} failed (${lastErr}), retrying…`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(
    `The drop was minted on-chain, but marking it live failed after retries (${lastErr}). ` +
      `Re-approve it from the New Drops tab to finish — the on-chain steps are already done and will be skipped.`
  );
}

export const {
  useCreateDropWithUploadsMutation,
  useGetApprovedDropsQuery,
  useGetDropsPendingApprovalQuery,
  useGetPresetDropsQuery,
  useApproveAndDeployDropMutation,
  useCreatePresetDropsMutation,
  useDeleteDropMutation,
  useDeleteDropsMutation,
  useGetOpenEditionMintCountQuery,
  useGetCollectionMintCountQuery,
  useAddArtworksToDropMutation,
  useUpdateDraftArtworkMutation,
  useDeleteDraftArtworkMutation,
  useGetDropAllowlistQuery,
  useCheckDropAllowlistQuery,
  useUpdateDropAllowlistMutation,
} = dropsApi;
