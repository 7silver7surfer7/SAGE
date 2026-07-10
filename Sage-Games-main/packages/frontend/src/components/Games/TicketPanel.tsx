import { Lottery_include_Nft } from '@/prisma/types';
import { useGetUserDisplayInfoQuery } from '@/store/services/user';
useGetUserDisplayInfoQuery;
import Image from 'next/image';
import { useBalance, useAccount } from 'wagmi';
import GetTicketModal from '@/components/Modals/Games/GetTicketModal';
import useModal from '@/hooks/useModal';
import { User } from '@prisma/client';
import { useGetPointsBalanceQuery, useGetEscrowPointsQuery } from '@/store/services/pointsReducer';
import Status from '@/components/Status';

interface Props {
  lottery: Lottery_include_Nft;
  artist: User;
  dropName: string;
  selectedNftIndex: number;
}

type GameStatus = 'Done' | 'Live' | 'Error';

function computeGameStatus(start: number, end: number, settled: boolean): GameStatus {
  if (settled) {
    return 'Done';
  }
  if (end < Date.now()) {
    return 'Done';
  }
  if (start < Date.now()) {
    return 'Live';
  }
  return 'Error';
}

// styles/components/_game-panel.scss
export default function LotteryPanel({ lottery, artist, dropName, selectedNftIndex }: Props) {
  const {
    isOpen: isTicketModalOpen,
    closeModal: closeTicketModal,
    openModal: openTicketModal,
  } = useModal();
  const { data: accountData } = useAccount();
  const { data: userBalance } = useBalance({ addressOrName: accountData?.address });
  const { data: userPoints } = useGetPointsBalanceQuery(undefined, { skip: !accountData?.address });
  const { data: escrowPoints } = useGetEscrowPointsQuery(undefined, {
    skip: !accountData?.address,
  });
  const userBalancePoints = userPoints! - escrowPoints!;
  return (
    <div className='game-panel'>
      <GetTicketModal
        isOpen={isTicketModalOpen}
        closeModal={closeTicketModal}
        nft={lottery.Nfts[selectedNftIndex]}
        lottery={lottery}
        artist={artist}
        dropName={dropName}
      />
      <div className='game-panel__header'>
        <h1 className='game-panel__header-title'>Tickets</h1>
        <div className='game-panel__balance-label'>
          Balance
          <div className='game-panel__balance'>{userBalancePoints} PIXEL</div>
          <div className='game-panel__balance'>
            {userBalance?.formatted} {userBalance?.symbol}
          </div>
        </div>
      </div>
      <div className='game-panel__pricing'>
        <div className='game-panel__pricing-item'>
          <h1 className='game-panel__pricing-label'>Pricing</h1>
          <div className='game-panel__price'>
            {lottery.costPerTicketPoints}
            <div className='game-panel__price-unit'>PIXEL +</div>
            {lottery.costPerTicketTokens}
            <div className='game-panel__price-unit'>Coins</div>
          </div>
        </div>
      </div>
      <p className='game-panel__extra-info'>
        This is a fair drop mechanic. Buy purchasing one or more tickets for this drop, you have the
        opportunity to be selected to buy this NFT. Losing tickets will be refunded.
      </p>
      <div className='game-panel__actions'>
        <button className='game-panel__interact-btn' onClick={openTicketModal}>
          Get Tickets
        </button>
        <Status endTime={lottery.endTime} startTime={lottery.startTime} settled={lottery.isLive} />
        <h1 className='game-panel__tickets-available'>
          <span className='game-panel__tickets-available-label'>Available</span>
          x/{lottery.maxTickets}
        </h1>
      </div>
    </div>
  );
}
