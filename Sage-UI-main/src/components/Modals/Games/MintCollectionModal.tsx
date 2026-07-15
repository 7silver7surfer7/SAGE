import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import Modal, { Props as ModalProps } from '@/components/Modals';
import { BaseMedia } from '@/components/Media/BaseMedia';
import System from '@/components/Icons/System';
import Countdown from '@/components/Countdown';
import PlusSVG from '@/public/icons/plus.svg';
import MinusSVG from '@/public/icons/minus.svg';
import SageFullLogo from '@/public/branding/sage-full-logo.svg';
import CloseSVG from '@/public/interactive/close.svg';
import { CollectionMint, User } from '@prisma/client';
import { parameters } from '@/constants/config';
import { dropsApi, useGetCollectionMintCountQuery } from '@/store/dropsReducer';
import { nftsApi } from '@/store/nftsReducer';
import { useDispatch } from 'react-redux';
import {
  approveERC20Transfer,
  extractErrorMessage,
  getCollectionContract,
} from '@/utilities/contracts';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import useAllowlistGate from '@/hooks/useAllowlistGate';
import { toDecimalString } from '@/utilities/decimalString';

interface Props extends ModalProps {
  collection: CollectionMint;
  artist: User;
  dropName: string;
  /** the drop's payment currency: 'SAGE' (default) or 'ETH' */
  currency?: string;
}

interface ErrorState {
  message: string;
  isError: boolean;
}

const INITIAL_ERROR_STATE: ErrorState = { message: '', isError: false };
const DEFAULT_MAX_MINTS = 50;

/**
 * Fixed-price sequential collection mint — clone of MintOpenEditionModal
 * minus the pixels path: every mint receives the NEXT unique image in the
 * collection (token i = image i), supply hard-capped at the image count.
 */
export default function MintCollectionModal({
  isOpen,
  closeModal,
  collection,
  artist,
  dropName,
  currency,
}: Props) {
  const isEthCollection = currency === 'ETH';
  const { signer, isSignedIn } = useSAGEAccount();
  const dispatch = useDispatch();
  const [quantity, setQuantity] = useState(1);
  const [isMinting, setIsMinting] = useState(false);
  const [errorState, setErrorState] = useState<ErrorState>(INITIAL_ERROR_STATE);
  const isOnChainReady = Boolean(parameters.COLLECTION_ADDRESS && collection.collectionId != null);
  const { data: liveMintCount } = useGetCollectionMintCountQuery(collection.collectionId!, {
    skip: collection.collectionId == null || !isOpen,
    pollingInterval: isOpen ? 15000 : undefined,
  });

  const now = Date.now();
  const isStarted = now >= new Date(collection.startTime).getTime();
  // null endTime = no deadline — selling out is the only closing condition
  const hasDeadline = collection.endTime != null;
  const isEnded = hasDeadline && now > new Date(collection.endTime as any).getTime();
  const mintedCount = liveMintCount ?? collection.mintCount;
  const remaining = Math.max(0, collection.maxSupply - mintedCount);
  const isSoldOut = remaining === 0;
  const isLive = isStarted && !isEnded && !isSoldOut;

  const maxPerUser = collection.limitPerUser;
  const requiresSAGE = collection.costTokens > 0;
  const sagePriceDisplay = `${collection.costTokens * quantity} ${isEthCollection ? 'ETH' : 'SAGE'}`;

  const gameInfo =
    `A collection of ${collection.maxSupply} unique artworks minted in order — every mint ` +
    `receives the next piece in the series at a fixed price.` +
    (hasDeadline
      ? ''
      : ' Minting stays open until the collection sells out — no time limit.') +
    (maxPerUser > 0 ? ` Each wallet can mint up to ${maxPerUser}.` : '');

  function validateQuantity() {
    if (!isSignedIn) {
      setErrorState({ message: 'please sign in', isError: true });
      return;
    }
    if (quantity < 1) {
      setErrorState({ message: "can't mint zero", isError: true });
      return;
    }
    if (maxPerUser > 0 && quantity > maxPerUser) {
      setErrorState({ message: 'max mints per user reached', isError: true });
      return;
    }
    if (quantity > remaining) {
      setErrorState({ message: `only ${remaining} left`, isError: true });
      return;
    }
    setErrorState(INITIAL_ERROR_STATE);
  }

  useEffect(() => {
    validateQuantity();
  }, [quantity, isSignedIn, remaining]);

  function handleSubClick() {
    if (quantity > 1) setQuantity((q) => q - 1);
  }

  function handleAddClick() {
    const cap = Math.min(maxPerUser > 0 ? maxPerUser : DEFAULT_MAX_MINTS, remaining || 1);
    setQuantity((q) => Math.min(cap, q + 1));
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuantity(+e.target.value);
  }

  async function handleMintClick() {
    if (!isOnChainReady) {
      toast.info('On-chain minting opens once the SAGE contracts are live on Robinhood Chain.');
      return;
    }
    if (!signer) {
      toast.info('Sign in to mint.');
      return;
    }
    setIsMinting(true);
    try {
      // IP-gated drops: claim a mint spot first (one per network). The server
      // adds this wallet to the drop's on-chain whitelist — without a claim
      // the contract mint below reverts 'Not whitelisted'. Idempotent, and a
      // no-op for ungated drops.
      const claimRes = await fetch(`/api/drops/?action=ClaimMintSpot&id=${collection.dropId}`);
      const claim = await claimRes.json().catch(() => ({}));
      if (!claimRes.ok) {
        toast.error(claim?.error || 'Could not claim a mint spot.');
        setIsMinting(false);
        return;
      }
      const contract = await getCollectionContract(signer);
      const weiTotal = ethers.utils.parseEther(toDecimalString(collection.costTokens * quantity));
      // ETH collections carry the payment as msg.value — no ERC-20 approval step
      if (requiresSAGE && !isEthCollection) {
        await approveERC20Transfer(parameters.ASHTOKEN_ADDRESS, contract.address, weiTotal, signer);
      }
      const tx = await contract.mint(
        collection.collectionId,
        quantity,
        isEthCollection && requiresSAGE ? { value: weiTotal } : {}
      );
      const receipt = await tx.wait(1);
      dispatch(
        dropsApi.util.invalidateTags([
          { type: 'CollectionMintCount', id: collection.collectionId! },
        ])
      );
      await registerMintedTokens(contract, receipt, collection.id, await signer.getAddress());
      dispatch(nftsApi.util.invalidateTags(['Nfts']));
      toast.success(
        `Minted ${quantity} piece${quantity > 1 ? 's' : ''} — they're in your collection!`
      );
      closeModal();
    } catch (e) {
      console.error(e);
      toast.error(extractErrorMessage(e));
    } finally {
      setIsMinting(false);
    }
  }

  // SageCollection enforces the allowlist on-chain ("Not whitelisted"); this
  // keeps the UX honest before the wallet prompt.
  const allowlistGate = useAllowlistGate(collection.dropId);
  const isAllowlistBlocked = allowlistGate.gated && !allowlistGate.allowed;
  const buttonText = isAllowlistBlocked
    ? 'allowlist only'
    : errorState.isError
    ? errorState.message
    : isMinting
    ? 'minting…'
    : 'mint';

  return (
    <Modal isOpen={isOpen} closeModal={closeModal}>
      <div className='games-modal'>
        <section className='games-modal__header'>
          <SageFullLogo className='games-modal__sage-logo' />
          <button className='games-modal__close-button'>
            <CloseSVG onClick={closeModal} className='games-modal__close-button-svg' />
          </button>
        </section>
        <section className='games-modal__body'>
          <div className='games-modal__main'>
            <div className='games-modal__main-img-container'>
              <BaseMedia
                src={collection.previewImagePath || ''}
                isZoomable={true}
                fit='contain'
              />
              {isLive && hasDeadline && (
                <Countdown
                  endTime={collection.endTime as any}
                  className='games-modal__countdown--float'
                ></Countdown>
              )}
            </div>
            <div className='games-modal__main-content'>
              <span className='games-modal__drop-name'>
                {dropName} by {artist.username}
                <span className='games-modal__editions-tag--mobile'>
                  {mintedCount} / {collection.maxSupply} minted
                </span>
              </span>
              <p className='games-modal__game-name'>{dropName}</p>
              <div className='games-modal__system'>
                <div className='games-modal__system-icon-container'>
                  <System type='listing'></System>
                </div>
                <p className='games-modal__system-info'>{gameInfo}</p>
              </div>

              {!isStarted && !isEnded && (
                <div className='games-modal__upcoming-section'>
                  <p className='games-modal__countdown-label'>Starts in</p>
                  <Countdown
                    endTime={collection.startTime}
                    className='games-modal__countdown'
                  ></Countdown>
                </div>
              )}

              {isLive && (
                <div className='games-modal__live-section'>
                  <div className='games-modal__ticket-cost-group'>
                    <p className='games-modal__ticket-cost-label'>
                      {requiresSAGE ? 'mint cost' : 'free mint'}
                    </p>
                    <p className='games-modal__ticket-cost-value'>
                      {requiresSAGE && sagePriceDisplay}
                    </p>
                  </div>
                  <div className='games-modal__tickets-controls'>
                    <MinusSVG onClick={handleSubClick} className='games-modal__tickets-sub' />
                    <input
                      type='number'
                      onChange={handleInputChange}
                      min={1}
                      max={Math.min(maxPerUser > 0 ? maxPerUser : DEFAULT_MAX_MINTS, remaining)}
                      className='games-modal__tickets-input'
                      value={quantity}
                    />
                    <PlusSVG onClick={handleAddClick} className='games-modal__tickets-add' />
                  </div>
                  <button
                    disabled={isMinting || errorState.isError || isAllowlistBlocked}
                    onClick={handleMintClick}
                    className='games-modal__buy-tickets-button'
                  >
                    {buttonText}
                  </button>
                  {!isOnChainReady && (
                    <p className='games-modal__system-info'>
                      On-chain minting opens once the SAGE contracts are live on Robinhood Chain.
                    </p>
                  )}
                </div>
              )}

              {(isEnded || isSoldOut) && (
                <div className='games-modal__upcoming-section'>
                  <p className='games-modal__countdown-label'>
                    {isSoldOut
                      ? `Sold out — all ${collection.maxSupply} pieces minted.`
                      : `This mint closed with ${mintedCount} of ${collection.maxSupply} minted.`}
                  </p>
                </div>
              )}
            </div>
          </div>
          <span className='games-modal__editions-tag--desktop'>
            {mintedCount} / {collection.maxSupply} minted
          </span>
        </section>
      </div>
    </Modal>
  );
}

/**
 * mint() mints straight to the caller on-chain with no API callback — this
 * reads the minted tokenIds AND their sequential collection indexes out of
 * the transaction's own logs (Transfer events + the contract's CollectionMint
 * event carrying firstIndex) and registers each token server-side, which
 * re-verifies on-chain ownership + tokenURI before writing.
 */
async function registerMintedTokens(
  collectionContract: ethers.Contract,
  receipt: ethers.ContractReceipt,
  collectionMintDbId: number,
  minterAddress: string
) {
  try {
    const onChain = await collectionContract.getCollection(collectionMintDbId);
    const nftContractAddress: string = onChain.nftContract;
    const transferTopic = ethers.utils.id('Transfer(address,address,uint256)');
    const tokenIds = receipt.logs
      .filter(
        (log) =>
          log.address.toLowerCase() === nftContractAddress.toLowerCase() &&
          log.topics[0] === transferTopic &&
          log.topics[1] === ethers.utils.hexZeroPad(ethers.constants.AddressZero, 32) &&
          log.topics[2].toLowerCase() === ethers.utils.hexZeroPad(minterAddress, 32).toLowerCase()
      )
      .map((log) => ethers.BigNumber.from(log.topics[3]).toNumber())
      .sort((a, b) => a - b);
    // the contract's CollectionMint event carries the first sequential index
    // of this batch; token k of the batch has index firstIndex + k
    const mintTopic = ethers.utils.id('CollectionMint(address,uint256,uint256,uint256)');
    const mintLog = receipt.logs.find(
      (log) =>
        log.address.toLowerCase() === collectionContract.address.toLowerCase() &&
        log.topics[0] === mintTopic
    );
    if (!mintLog) throw new Error('CollectionMint event not found in receipt');
    const [, firstIndex] = ethers.utils.defaultAbiCoder.decode(
      ['uint256', 'uint256'],
      mintLog.data
    );
    await Promise.all(
      tokenIds.map((tokenId, k) =>
        fetch('/api/endpoints/dropUpload?action=RegisterCollectionMint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collectionMintId: collectionMintDbId,
            tokenId,
            index: Number(firstIndex) + k,
          }),
        })
      )
    );
  } catch (e) {
    // the mint already succeeded on-chain — don't fail the flow over bookkeeping
    console.error('registerMintedTokens() failed', e);
  }
}
