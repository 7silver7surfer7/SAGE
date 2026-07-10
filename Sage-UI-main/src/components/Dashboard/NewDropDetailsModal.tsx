import Modal, { Props as ModalProps } from '@/components/Modals';
import { Drop_include_GamesAndArtist } from '@/prisma/types';
import { formatDateYYMMddHHmm } from '@/utilities/strings';

interface NewDropDetailsModalProps extends ModalProps {
  drop: Drop_include_GamesAndArtist;
}

export function NewDropDetailsModal({ isOpen, closeModal, drop }: NewDropDetailsModalProps) {
  return (
    <Modal title='Drop Details' isOpen={isOpen} closeModal={closeModal}>
      <div className='dashboard__drop-details-modal' style={{ padding: '25px' }}>
        <div style={{ textAlign: 'center', fontSize: '12px', lineHeight: '18px' }}>
          DROP {drop.id}
          <br />
          <br />
          <img src={drop.bannerImageS3Path} width={300} />
          <br />
          <span style={{ fontSize: '14px', fontWeight: 'bold' }}>
            {drop.name}, by {drop.NftContract.Artist.username}
          </span>
          <br />
          <br />
          {drop.description && <span>{drop.description}</span>}
          <hr />
          {drop.Lotteries && (
            <div style={{ display: 'flex' }}>
              {drop.Lotteries.map((lottery, i) => {
                const nft = lottery.Nfts[0];
                return (
                  <div key={i} style={{ padding: '10px', width: '175px' }}>
                    DRAWING {lottery.id}
                    <br />
                    <br />
                    Starts: {formatDateYYMMddHHmm(lottery.startTime)}
                    <br />
                    Ends: {formatDateYYMMddHHmm(lottery.endTime)}
                    <br />
                    Cost: {lottery.costPerTicketTokens} SAGE + {lottery.costPerTicketPoints} PIXEL
                    <br />
                    Max Tickets: {lottery.maxTickets} total, {lottery.maxTicketsPerUser} per user
                    <br />
                    <br />
                    <div style={{ display: 'flex' }}>
                      <div key={i} style={{ marginLeft: 'auto', marginRight: 'auto' }}>
                        <img src={nft.s3PathOptimized} width={150} />
                        <br />
                        Name: {nft.name}
                        <br />
                        Editions: {nft.numberOfEditions}
                        <br />
                        {nft.description && <span>"{nft.description}"</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <hr />
          {drop.Auctions && (
            <div style={{ display: 'flex' }}>
              {drop.Auctions.map((auction, i) => {
                return (
                  <div key={i} style={{ padding: '10px', width: '175px' }}>
                    AUCTION {auction.id}
                    <br />
                    <br />
                    Starts: {formatDateYYMMddHHmm(auction.startTime)}
                    <br />
                    Ends: {formatDateYYMMddHHmm(auction.endTime)}
                    <br />
                    Min Price: {auction.minimumPrice} SAGE
                    <br />
                    <br />
                    <img src={auction.Nft.s3PathOptimized} width={150} />
                    <br />
                    Name: {auction.Nft.name}
                    <br />
                    {auction.Nft.description && <span>"{auction.Nft.description}"</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
