import { useSigner } from 'wagmi';
import { toast } from 'react-toastify';
import { Nft_include_NftContractAndOffers } from '@/prisma/types';
import { Offer, User } from '@prisma/client';
import Modal, { Props as ModalProps } from '@/components/Modals';
import SageFullLogo from '@/public/branding/sage-full-logo.svg';
import CloseSVG from '@/public/interactive/close.svg';
import { BaseMedia } from '@/components/Media/BaseMedia';
import { useBuyFromSellOfferMutation } from '@/store/nftsReducer';
import LoaderSpinner from '@/components/LoaderSpinner';
import { useSession } from 'next-auth/react';

interface Props extends ModalProps {
  artist: User;
  nft: Nft_include_NftContractAndOffers;
  offer: Offer;
}

//@scss : '@/styles/components/_games-modal.scss'
export default function BuyNowModal({ isOpen, closeModal, artist, nft, offer }: Props) {
  const [buyFromSellOffer, { isLoading }] = useBuyFromSellOfferMutation();
  const { data: signer } = useSigner();
  const { data: sessionData } = useSession();

  const handleClick = async () => {
    if (!signer || !sessionData) {
      toast.info('Please sign in with a wallet.');
    } else if (isLoading) {
      toast.info('Please wait for transaction to complete.');
    } else {
      await buyFromSellOffer({ tokenId: nft.tokenId, offer, signer });
      closeModal();
    }
  };

  return (
    <Modal isOpen={isOpen} closeModal={closeModal}>
      <div className='games-modal'>
        <section className='games-modal__header'>
          <SageFullLogo className='games-modal__sage-logo' />
          <CloseSVG onClick={closeModal} className='games-modal__close-button' />
        </section>
        <section className='games-modal__body'>
          <div className='games-modal__main-img-container'>
            <BaseMedia src={nft.s3PathOptimized} isZoomable={true} fit='contain' />
          </div>
          <div className='games-modal__main-content'>
            <div>
              <h1 className='games-modal__drop-name'>by {artist.username}</h1>
              <h1 className='games-modal__game-name'>{nft.name}</h1>
            </div>
            {nft.description && (
              <p className='games-modal__game-description'>{nft.description}</p>
            )}
            <p className='games-modal__price-fixed'>{nft.price} SAGE</p>
            <div
              className='games-modal__game-description'
              style={{ textAlign: 'right', fontSize: '80%' }}
            >
              fixed price
            </div>
            <button
              disabled={isLoading}
              className='games-modal__place-bid-button'
              onClick={handleClick}
            >
              {isLoading ? <LoaderSpinner /> : 'buy now'}
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
