import { useEffect, useState } from 'react';
import { Signer } from 'ethers';
import { erc20ABI, useContractRead, useSigner } from 'wagmi';
import { toast } from 'react-toastify';
import { Auction_include_Nft } from '@/prisma/types';
import type { User } from '@prisma/client';
import { AuctionState, usePlaceBidMutation } from '@/store/auctionsReducer';
import Modal, { Props as ModalProps } from '@/components/Modals';
import SageFullLogo from '@/public/branding/sage-full-logo.svg';
import CloseSVG from '@/public/interactive/close.svg';
import { BaseMedia } from '@/components/Media/BaseMedia';
import System from '@/components/Icons/System';
import BidHistoryTable from '@/components/Games/BidHistoryTable';
import Countdown from '@/components/Countdown';
import ArrowRightSVG from '@/public/interactive/arrow-right.svg';
import { transformTitle } from '@/utilities/strings';
import useAuction from '@/hooks/useAuction';
import { useSession } from 'next-auth/react';
import shortenAddress from '@/utilities/shortenAddress';
import ClaimPrizeButton from '@/components/Pages/Profile/ClaimPrizeButton';
import { parameters } from '@/constants/config';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import useAllowlistGate from '@/hooks/useAllowlistGate';

interface Props extends ModalProps {
  auction: Auction_include_Nft;
  artist: User;
  dropName: string;
  /** the drop's payment currency: 'SAGE' (default) or 'ETH' */
  currency?: string;
}

type DesiredBidValue = number;

interface State {
  desiredBidValue: DesiredBidValue;
  minBid: DesiredBidValue;
  shouldShowBidHistory: boolean;
}

interface ErrorState {
  isError: boolean;
  errorMessage: string;
}

const initialState: State = {
  desiredBidValue: 0,
  minBid: 0,
  shouldShowBidHistory: false,
};

// export function computeAuctionStatus(auction: Auction_include_Nft, auctionState: AuctionState) {
//   const now = new Date().getTime();
//   const isOpenForBids =
//     auctionState && auctionState.endTime > now && auction.startTime.getTime() < now;
//   const isStarted = auction.startTime.getTime() < now;

//   const isEnded = auctionState
//     ? Boolean(auctionState.endTime !== undefined) && Boolean(auctionState.endTime < now)
//     : false;
//   return { isOpenForBids, isStarted, isEnded };
// }

const INITIAL_ERROR_STATE = { isError: false, errorMessage: '' };

//@scss : '@/styles/components/_games-modal.scss'
function PlaceBidModal({ isOpen, closeModal, auction, artist, dropName, currency }: Props) {
  const [state, setState] = useState<State>(initialState);
  const [errorState, setErrorState] = useState<ErrorState>(INITIAL_ERROR_STATE);
  const [placeBid, { isLoading: isPlaceBidLoading }] = usePlaceBidMutation();
  const { data: signer } = useSigner();
  const { walletAddress } = useSAGEAccount();
  const { data: allowance } = useContractRead({
    addressOrName: parameters.ASHTOKEN_ADDRESS,
    contractInterface: erc20ABI,
    functionName: 'allowance',
    args: [walletAddress, parameters.AUCTION_ADDRESS],
    watch: true,
  });
  const allowanceNumber = +allowance;
  const needApproval = allowanceNumber < state.desiredBidValue;

  const {
    nftName,
    auctionState,
    nftPath,
    artistName,
    isStarted,
    isRunning,
    isEnded,
    isOpenForBids,
    endTime,
    highestBidder,
    highestBid,
    nextMinBid,
    description,
    prize,
    gameInfo,
  } = useAuction({ auction, artist, walletAddress: walletAddress as string });

  function toggleBidHistory() {
    setState((prevState) => {
      return { ...prevState, shouldShowBidHistory: !prevState.shouldShowBidHistory };
    });
  }

  function handlePlaceBidClick() {
    placeBid({ auctionId: auction.id, amount: state.desiredBidValue, signer: signer as Signer });
  }

  function handleBidInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setState((prevState) => {
      return { ...prevState, desiredBidValue: +e.target.value };
    });
  }

  function handleNewAuctionState() {
    if (!auctionState) return;
    if (nextMinBid != 0) {
      const nextMinBid = roundNextMinBid(auctionState.nextMinBid);
      setState((prevState) => {
        return {
          ...prevState,
          desiredBidValue: nextMinBid,
          minBid: nextMinBid,
        };
      });
    }
  }

  function handleStartingBid() {
    if (!auction.minimumPrice) return;
    if (nextMinBid) return;
    setState((prevState) => {
      return {
        ...prevState,
        desiredBidValue: Number(auction.minimumPrice),
        minBid: Number(auction.minimumPrice),
      };
    });
  }

  // Allowlist gate — for auctions this is the ONLY gate (no on-chain hook),
  // so the bid button itself is disabled for wallets not on the list.
  const allowlistGate = useAllowlistGate(auction.dropId);
  const isAllowlistBlocked = allowlistGate.gated && !allowlistGate.allowed;
  const buttonText = needApproval ? 'approve' : 'place bid';
  const buttonDisplay = isAllowlistBlocked
    ? 'allowlist only'
    : errorState.isError
    ? errorState.errorMessage
    : buttonText;

  useEffect(() => {
    if (!signer) {
      setErrorState({ isError: true, errorMessage: 'wallet not connected' });
      return;
    }

    setErrorState(INITIAL_ERROR_STATE);
  }, [signer]);

  useEffect(() => {
    handleStartingBid();
  }, []);

  useEffect(() => {
    handleNewAuctionState();
  }, [auctionState]);

  return (
    <Modal isOpen={isOpen} closeModal={closeModal}>
      <div className='games-modal'>
        <section className='games-modal__header'>
          <SageFullLogo className='games-modal__sage-logo' />
          <button className='games-modal__close-button'>
            <CloseSVG onClick={closeModal} className='games-modal__close-button-svg' />
          </button>
        </section>
        <div className='games-modal__body'>
          <section className='games-modal__main'>
            <div className='games-modal__main-img-container'>
              <BaseMedia src={auction.Nft.s3Path} type={auction.Nft.mediaType} isZoomable={true} fit='contain' />

              {isOpenForBids && isRunning && (
                <Countdown endTime={endTime} className='games-modal__countdown--float'></Countdown>
              )}
            </div>
            <div className='games-modal__main-content'>
              <div>
                <p className='games-modal__drop-name'>
                  {transformTitle(dropName)} by {artistName}
                </p>
                <p className='games-modal__game-name'>{nftName}</p>
              </div>
              {description && <p className='games-modal__game-description'>{description}</p>}
              <div className='games-modal__system'>
                <div className='games-modal__system-icon-container'>
                  <System type='auction'></System>
                </div>
                <p className='games-modal__system-info'>{gameInfo}</p>
              </div>
              {isEnded && walletAddress && walletAddress == highestBidder && (
                <div style={{ marginBottom: '25px' }}>
                  <div className='games-modal__bid-info-group'>
                    <div className='games-modal__highest-bid'>
                      <p className='games-modal__highest-bid-label'>WINNER</p>
                      <p className='games-modal__highest-bid-value'>
                        {shortenAddress(highestBidder)}
                      </p>
                      &nbsp; &nbsp;
                      <ClaimPrizeButton gamePrize={prize} />
                    </div>
                  </div>
                </div>
              )}
              {isStarted && (
                <div>
                  <div className='games-modal__bid-info-group'>
                    <div className='games-modal__highest-bid'>
                      <p className='games-modal__highest-bid-label'>Highest Bid</p>
                      <p className='games-modal__highest-bid-value'>{highestBid} {currency === 'ETH' ? 'ETH' : 'SAGE'}</p>
                    </div>
                    <button
                      onClick={toggleBidHistory}
                      className='games-modal__see-bid-history-button'
                    >
                      <ArrowRightSVG
                        data-is-open={state.shouldShowBidHistory}
                        className='games-modal__see-bid-history-icon'
                      ></ArrowRightSVG>
                      Bid History
                    </button>
                  </div>
                </div>
              )}
              {!isStarted && !isEnded && (
                <div className='games-modal__upcoming-section'>
                  <p className='games-modal__countdown-label'>Starts in</p>
                  <Countdown
                    endTime={auction.startTime}
                    className='games-modal__countdown'
                  ></Countdown>
                </div>
              )}
              {isStarted && !isEnded && (
                <>
                  <input
                    onChange={handleBidInputChange}
                    type='number'
                    className='games-modal__bid-input'
                    min={nextMinBid}
                    value={state.desiredBidValue}
                  />
                  <button
                    disabled={
                      isPlaceBidLoading ||
                      errorState.isError ||
                      isAllowlistBlocked ||
                      // the input's min={nextMinBid} is cosmetic — typing a
                      // negative/zero/below-floor value still enabled this
                      // button, relying entirely on the chain to reject it
                      !Number.isFinite(state.desiredBidValue) ||
                      state.desiredBidValue < nextMinBid
                    }
                    className='games-modal__place-bid-button'
                    onClick={handlePlaceBidClick}
                  >
                    {buttonDisplay}
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
        <section className='games-modal__bid-history-section'>
          <BidHistoryTable
            isActive={state.shouldShowBidHistory}
            auctionId={auction.id}
          ></BidHistoryTable>
        </section>
      </div>
    </Modal>
  );
}

function roundNextMinBid(val: number): number {
  return Math.ceil(val * 100) / 100;
}

export default PlaceBidModal;
