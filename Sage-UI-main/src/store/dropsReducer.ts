import { ethers, Signer } from 'ethers';
import { DropFull, Drop_include_GamesAndArtist, Splitter_include_Entries } from '@/prisma/types';
import { toast } from 'react-toastify';
import {
  assertSignerOnConfiguredChain,
  extractErrorMessage,
  getAuctionContract,
  getLotteryContract,
  getOpenEditionContract,
} from '@/utilities/contracts';
import splitterContractJson from '@/constants/abis/Utils/Splitter.sol/Splitter.json';
import { fetchOrCreateNftContract } from './nftsReducer';
import { baseApi } from './baseReducer';
import { Role } from '@prisma/client';
import { createNftMetadataOnArweave, uploadFileToArweave } from '@/utilities/arweave-client';
import { dropProgress } from '@/utilities/dropProgress';
import { isVideoSrc } from '@/utilities/media';

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
    createDropWithUploads: builder.mutation<number, CreateDropRequest>({
      queryFn: async (req, {}, _, fetchWithBQ) => {
        // Once the drop row exists, a later failure (usually the on-chain
        // deploy) must NOT read as "the drop failed" — the uploads are done
        // and the deploy can be retried from the New Drops tab.
        let createdDropId = 0;
        dropProgress.reset();
        dropProgress.note(`Creating drop "${req.name}" (${req.artworks.length} artwork${req.artworks.length === 1 ? '' : 's'})`);
        try {
          const { url: bannerUrl } = await dropProgress.track('Uploading banner to Arweave', () =>
            uploadFileToArweave(req.bannerFile)
          );
          let artistProfilePicture: string | undefined;
          if (req.artistIconFile) {
            const { url, optimizedUrl } = await dropProgress.track(
              'Uploading artist icon to Arweave',
              () => uploadFileToArweave(req.artistIconFile as File)
            );
            artistProfilePicture = optimizedUrl || url;
          }
          const { data: dropResult } = await dropProgress.track('Creating drop record', async () =>
            fetchWithBQ({
              url: 'endpoints/dropUpload?action=InsertDrop',
              method: 'POST',
              body: {
                artistWallet: req.artistWallet,
                artistDisplayName: req.artistDisplayName,
                artistProfilePicture,
                name: req.name,
                description: req.description,
                bannerImageS3Path: bannerUrl,
                tileImageS3Path: bannerUrl,
                goLiveAt: req.goLiveAt,
              },
            })
          );
          if ((dropResult as any)?.error) throw new Error((dropResult as any).error);
          const dropId = (dropResult as any).dropId as number;
          createdDropId = dropId;
          // games open at the explicit sale-start time; falling back to go-live
          // (old single-timestamp behavior), then to 5 minutes from now
          const startDate =
            req.saleStartAt ?? req.goLiveAt ?? Math.floor(Date.now() / 1000) + 300;
          const endDate = startDate + req.durationHours * 3600;
          const endpoint = '/api/endpoints/dropUpload/';
          const total = req.artworks.length;
          for (let i = 0; i < total; i++) {
            const artwork = req.artworks[i];
            const label = artwork.name || `artwork ${i + 1}`;
            const { url, optimizedUrl } = await dropProgress.track(
              `Uploading "${label}" to Arweave (${i + 1}/${total})`,
              () => uploadFileToArweave(artwork.file)
            );
            const { width, height } = await getMediaDimensions(artwork.file);
            // Build the ERC-721 metadata JSON and store it on Arweave; its URL
            // becomes the on-chain tokenURI when the drop is deployed. Without
            // this, minted NFTs would have a null/blank metadata pointer.
            const isVideo = artwork.file.type === 'video/mp4';
            const metadataPath = await dropProgress.track(
              `Writing metadata for "${label}" to Arweave`,
              () => createNftMetadataOnArweave(endpoint, artwork.name, artwork.description, url, isVideo)
            );
            const media = {
              name: artwork.name,
              description: artwork.description,
              arweavePath: url,
              metadataPath,
              s3Path: url,
              s3PathOptimized: optimizedUrl,
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
          return { data: dropId };
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
            // the drop exists; hand its id back so the form clears normally
            return { data: createdDropId };
          }
          toast.error(`Error creating drop: ${message}`, { autoClose: false });
          return { data: 0 };
        }
      },
      invalidatesTags: ['PendingDrops'],
    }),
    getApprovedDrops: builder.query<Drop_include_GamesAndArtist[], void>({
      query: () => `drops?action=GetApprovedDrops`,
      providesTags: ['PendingDrops'],
    }),
    getDropsPendingApproval: builder.query<Drop_include_GamesAndArtist[], void>({
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
    deleteDrops: builder.mutation<null, void>({
      query: () => `drops?action=DeleteDrops`,
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
  //await processSplitter(drop.PrimarySplitter, signer, fetchWithBQ);
  //await processSplitter(drop.SecondarySplitter, signer, fetchWithBQ);
  //await createNftCollection(drop, signer);
  const artistNftContractAddress = await deployStep('artist NFT contract', () =>
    fetchOrCreateNftContract(drop.artistAddress, signer, fetchWithBQ)
  );
  if (artistNftContractAddress == ethers.constants.AddressZero) {
    throw new Error('Unable to deploy a new artist NFT contract');
  }
  // trigger server-side task that optimizes NFT images
  await fetchWithBQ(`drops?action=OptimizeDropImages&id=${dropId}`);
  await deployStep('auctions', () =>
    deployAuctions(drop, artistNftContractAddress, signer, fetchWithBQ)
  );
  await deployStep('lotteries', () =>
    deployLotteries(drop, artistNftContractAddress, signer, fetchWithBQ)
  );
  await deployStep('open editions', () =>
    deployOpenEditions(drop, artistNftContractAddress, signer, fetchWithBQ)
  );
  await deployStep('approval flags', () => updateDbApprovedDateAndIsLiveFlags(drop, fetchWithBQ));
  // fire-and-forget: warm the media proxy's iOS-safe transcode for any video in
  // this drop, so the first mobile viewer at go-live gets a cache hit instead
  // of waiting on the transcode. Never blocks or fails the deploy.
  prewarmDropVideos(drop);
}

/** Kick off /api/media prewarm for every video NFT in a drop (fire-and-forget). */
function prewarmDropVideos(drop: DropFull) {
  try {
    const nfts = [
      ...drop.Auctions.map((a) => a.Nft),
      ...drop.Lotteries.flatMap((l) => l.Nfts),
      ...drop.OpenEditions.map((oe) => oe.Nft),
    ];
    const txids = new Set<string>();
    for (const nft of nfts) {
      const src = nft?.s3PathOptimized;
      if (!src || !isVideoSrc(src)) continue;
      const m = /arweave\.net\/([A-Za-z0-9_-]{43})/.exec(src);
      if (m) txids.add(m[1]);
    }
    txids.forEach((txid) => {
      fetch(`/api/media/${txid}/?prewarm=1`).catch(() => {});
    });
    if (txids.size) console.log(`prewarmDropVideos() :: warming ${txids.size} video(s)`);
  } catch (e) {
    console.log('prewarmDropVideos() skipped', e);
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
    const tx = await auctionContract.createAuctionBatch(createParams);
    await tx.wait();
    for (const { auctionId } of createParams) {
      const params = `id=${auctionId}&address=${auctionContract.address}`;
      await fetchWithBQ(`drops?action=UpdateAuctionContractAddress&${params}`);
    }
  }
}

async function deployLotteries(
  drop: DropFull,
  artistNftContractAddress: string,
  signer: Signer,
  fetchWithBQ: any
) {
  const createParams = [];
  for (const l of drop.Lotteries) {
    if (l.contractAddress) {
      console.log(`deployLotteries() :: ${l.id} has already been deployed to ${l.contractAddress}`);
      continue;
    }
    const startTime = Math.floor(new Date(l.startTime).getTime() / 1000);
    const endTime = Math.floor(new Date(l.endTime).getTime() / 1000);
    const costPerTicketTokens = ethers.utils.parseEther(l.costPerTicketTokens.toString());
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
    const tx = await lotteryContract.createLotteryBatch(createParams);
    await tx.wait();
    for (const { lotteryID } of createParams) {
      const params = `id=${lotteryID}&address=${lotteryContract.address}`;
      await fetchWithBQ(`drops?action=UpdateLotteryContractAddress&${params}`);
    }
  }
}

async function deployOpenEditions(
  drop: DropFull,
  artistNftContractAddress: string,
  signer: Signer,
  fetchWithBQ: any
) {
  const toDeploy = drop.OpenEditions.filter((oe) => !oe.contractAddress);
  if (toDeploy.length === 0) return;
  console.log(`deployOpenEditions() :: Deploying ${toDeploy.length} open edition(s)...`);
  const openEditionContract = await getOpenEditionContract(signer);
  for (const oe of toDeploy) {
    const startTime = Math.floor(new Date(oe.startTime).getTime() / 1000);
    const closeTime = Math.floor(new Date(oe.endTime).getTime() / 1000);
    const costTokens = ethers.utils.parseEther(String(oe.costTokens));
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
      whitelist: ethers.constants.AddressZero,
      costTokens,
    });
    await tx.wait();
    const params = `id=${oe.id}&address=${openEditionContract.address}`;
    await fetchWithBQ(`drops?action=UpdateOpenEditionContractAddress&${params}`);
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
  const { data } = await fetchWithBQ(`drops?action=UpdateApprovedDateAndIsLiveFlags&id=${drop.id}`);
  return data.approvedAt;
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
} = dropsApi;
