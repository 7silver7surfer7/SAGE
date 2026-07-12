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
import { OpenEdition_include_Nft, User } from '@/prisma/types';
import { parameters } from '@/constants/config';
import { useGetEarnedPointsQuery } from '@/store/pointsReducer';
import { dropsApi, useGetOpenEditionMintCountQuery } from '@/store/dropsReducer';
import { nftsApi } from '@/store/nftsReducer';
import { useDispatch } from 'react-redux';
import {
  approveERC20Transfer,
  extractErrorMessage,
  getOpenEditionContract,
} from '@/utilities/contracts';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import useAllowlistGate from '@/hooks/useAllowlistGate';

interface Props extends ModalProps {
  openEdition: OpenEdition_include_Nft;
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
const DEFAULT_MAX_MINTS = 300;

//@scss : '@/styles/components/_games-modal.scss'
export default function MintOpenEditionModal({
  isOpen,
  closeModal,
  openEdition,
  artist,
  dropName,
  currency,
}: Props) {
  const isEthEdition = currency === 'ETH';
  const { signer, isSignedIn, sessionData } = useSAGEAccount();
  const dispatch = useDispatch();
  const [quantity, setQuantity] = useState(1);
  const [isMinting, setIsMinting] = useState(false);
  const [errorState, setErrorState] = useState<ErrorState>(INITIAL_ERROR_STATE);
  const { data: earnedPoints } = useGetEarnedPointsQuery(undefined, { skip: !sessionData });
  // on-chain minting needs the SAGEOpenEdition contract deployed and this
  // edition registered on it (editionId assigned at deploy/approval time)
  const isOnChainReady = Boolean(parameters.OPENEDITION_ADDRESS && openEdition.editionId != null);
  // DB's mintCount is a deploy-time snapshot that's never updated after —
  // read the live count from the contract instead so it reflects real mints.
  const { data: liveMintCount } = useGetOpenEditionMintCountQuery(openEdition.editionId!, {
    skip: openEdition.editionId == null || !isOpen,
    pollingInterval: isOpen ? 15000 : undefined,
  });

  const now = Date.now();
  const isStarted = now >= new Date(openEdition.startTime).getTime();
  const isEnded = now > new Date(openEdition.endTime).getTime();
  const isLive = isStarted && !isEnded;

  const maxPerUser = openEdition.maxPerUser;
  const requiresSAGE = openEdition.costTokens > 0;
  const requiresPoints = openEdition.costPoints > 0;
  const sagePriceDisplay = `${openEdition.costTokens * quantity} ${isEthEdition ? 'ETH' : 'SAGE'}`;
  const pixelPriceDisplay = `${openEdition.costPoints * quantity} PIXEL`;

  // "3 days" / "1 week" for whole-day windows, hours otherwise ("1.5 hours")
  const durationHours = Number(
    (
      (new Date(openEdition.endTime).getTime() - new Date(openEdition.startTime).getTime()) /
      3600000
    ).toFixed(2)
  );
  const durationDisplay =
    durationHours === 168
      ? '1 week'
      : durationHours % 24 === 0 && durationHours >= 24
      ? `${durationHours / 24} day${durationHours === 24 ? '' : 's'}`
      : `${durationHours} hour${durationHours === 1 ? '' : 's'}`;
  const gameInfo = `Users can mint this artwork as an open edition for ${durationDisplay}. Every mint is a numbered edition of the same artwork.${
    maxPerUser > 0 ? ` Each wallet can mint up to ${maxPerUser}.` : ''
  }`;

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
    if (requiresPoints && earnedPoints) {
      if (openEdition.costPoints * quantity > +earnedPoints.totalPointsEarned) {
        setErrorState({ message: 'insufficient pixels', isError: true });
        return;
      }
    }
    setErrorState(INITIAL_ERROR_STATE);
  }

  useEffect(() => {
    validateQuantity();
  }, [quantity, earnedPoints, isSignedIn]);

  function handleSubClick() {
    if (quantity > 1) setQuantity((q) => q - 1);
  }

  function handleAddClick() {
    const cap = maxPerUser > 0 ? maxPerUser : DEFAULT_MAX_MINTS;
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
    if (requiresPoints && !earnedPoints?.signedMessage) {
      toast.error('Unable to verify your pixel balance — please refresh and try again.');
      return;
    }
    setIsMinting(true);
    try {
      const contract = await getOpenEditionContract(signer);
      const weiTotal = ethers.utils.parseEther(String(openEdition.costTokens * quantity));
      // ETH editions carry the payment as msg.value — no ERC-20 approval step
      if (requiresSAGE && !isEthEdition) {
        await approveERC20Transfer(parameters.ASHTOKEN_ADDRESS, contract.address, weiTotal, signer);
      }
      const ethOverrides = isEthEdition && requiresSAGE ? { value: weiTotal } : {};
      // batchMint alone checks the Rewards contract's on-chain points ledger,
      // which starts at zero for every wallet until claimed — the pixel
      // balance shown in the UI is computed off-chain and never reaches the
      // contract on its own. claimPointsAndMint verifies the signed balance
      // from the oracle and claims it on-chain (if not already claimed)
      // before minting, in one transaction.
      const tx = requiresPoints
        ? await contract.claimPointsAndMint(
            openEdition.editionId,
            quantity,
            earnedPoints!.totalPointsEarned,
            earnedPoints!.signedMessage,
            ethOverrides
          )
        : await contract.batchMint(openEdition.editionId, quantity, ethOverrides);
      const receipt = await tx.wait(1);
      dispatch(
        dropsApi.util.invalidateTags([
          { type: 'OpenEditionMintCount', id: openEdition.editionId! },
        ])
      );
      await registerMintedTokens(contract, receipt, openEdition.id, await signer.getAddress());
      dispatch(nftsApi.util.invalidateTags(['Nfts']));
      toast.success(`Minted ${quantity} edition${quantity > 1 ? 's' : ''}!`);
      closeModal();
    } catch (e) {
      console.error(e);
      toast.error(extractErrorMessage(e));
    } finally {
      setIsMinting(false);
    }
  }

  // Allowlist gate — the SAGEOpenEdition contract enforces the list on-chain
  // ("Not whitelisted" revert); this keeps the UX honest before the wallet
  // prompt instead of failing at transaction time.
  const allowlistGate = useAllowlistGate(openEdition.dropId);
  const isAllowlistBlocked = allowlistGate.gated && !allowlistGate.allowed;
  const buttonText = isAllowlistBlocked
    ? 'allowlist only'
    : errorState.isError
    ? errorState.message
    : isMinting
    ? 'minting…'
    : 'mint';
  const mintedCount = liveMintCount ?? openEdition.mintCount;

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
              <BaseMedia src={openEdition.Nft.s3PathOptimized} isZoomable={true} fit='contain' />
              {isLive && (
                <Countdown
                  endTime={openEdition.endTime}
                  className='games-modal__countdown--float'
                ></Countdown>
              )}
            </div>
            <div className='games-modal__main-content'>
              <span className='games-modal__drop-name'>
                {dropName} by {artist.username}
                <span className='games-modal__editions-tag--mobile'>{mintedCount} minted</span>
              </span>
              <p className='games-modal__game-name'>{openEdition.Nft.name}</p>
              {openEdition.Nft.description && (
                <p className='games-modal__game-description'>{openEdition.Nft.description}</p>
              )}
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
                    endTime={openEdition.startTime}
                    className='games-modal__countdown'
                  ></Countdown>
                </div>
              )}

              {isLive && (
                <div className='games-modal__live-section'>
                  <div className='games-modal__ticket-cost-group'>
                    <p className='games-modal__ticket-cost-label'>
                      {requiresSAGE || requiresPoints ? 'mint cost' : 'free mint'}
                    </p>
                    <p className='games-modal__ticket-cost-value'>
                      {requiresSAGE && sagePriceDisplay} {requiresSAGE && requiresPoints ? '+' : null}{' '}
                      {requiresPoints && pixelPriceDisplay}
                    </p>
                  </div>
                  <div className='games-modal__tickets-controls'>
                    <MinusSVG onClick={handleSubClick} className='games-modal__tickets-sub' />
                    <input
                      type='number'
                      onChange={handleInputChange}
                      min={1}
                      max={maxPerUser > 0 ? maxPerUser : DEFAULT_MAX_MINTS}
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

              {isEnded && (
                <div className='games-modal__upcoming-section'>
                  <p className='games-modal__countdown-label'>
                    This edition closed with {mintedCount} mint{mintedCount === 1 ? '' : 's'}.
                  </p>
                </div>
              )}
            </div>
          </div>
          <span className='games-modal__editions-tag--desktop'>{mintedCount} minted</span>
        </section>
      </div>
    </Modal>
  );
}

/**
 * batchMint/claimPointsAndMint mint straight to the caller's wallet on-chain
 * with no callback to the API — nothing else ever tells the DB a mint
 * happened, so the new token would never show up in "My Collection". Reads
 * the newly-minted tokenId(s) out of the mint transaction's own Transfer
 * logs and registers each one server-side (which independently re-verifies
 * on-chain ownership before writing anything).
 */
async function registerMintedTokens(
  openEditionContract: ethers.Contract,
  receipt: ethers.ContractReceipt,
  openEditionDbId: number,
  minterAddress: string
) {
  try {
    const onChainEdition = await openEditionContract.getOpenEdition(openEditionDbId);
    const nftContractAddress: string = onChainEdition.nftContract;
    const transferTopic = ethers.utils.id('Transfer(address,address,uint256)');
    const tokenIds = receipt.logs
      .filter(
        (log) =>
          log.address.toLowerCase() === nftContractAddress.toLowerCase() &&
          log.topics[0] === transferTopic &&
          // Transfer(from, to, tokenId): from == address(0) marks a mint;
          // to must match the minter (defends against parsing an unrelated log)
          log.topics[1] === ethers.utils.hexZeroPad(ethers.constants.AddressZero, 32) &&
          log.topics[2].toLowerCase() === ethers.utils.hexZeroPad(minterAddress, 32).toLowerCase()
      )
      .map((log) => ethers.BigNumber.from(log.topics[3]).toNumber());
    await Promise.all(
      tokenIds.map((tokenId) =>
        fetch('/api/endpoints/dropUpload?action=RegisterOpenEditionMint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openEditionId: openEditionDbId, tokenId }),
        })
      )
    );
  } catch (e) {
    // the mint itself already succeeded on-chain — don't fail the whole flow
    // over this bookkeeping step, just leave the collection entry to catch up later
    console.error('registerMintedTokens() failed', e);
  }
}
