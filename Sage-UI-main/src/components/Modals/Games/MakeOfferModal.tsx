import { useEffect, useState } from 'react';
import { ethers, Signer } from 'ethers';
import { useBalance, useSigner } from 'wagmi';
import { toast } from 'react-toastify';
import { Nft_include_NftContractAndOffers } from '@/prisma/types';
import { Offer, OfferState, User } from '@prisma/client';
import Modal, { Props as ModalProps } from '@/components/Modals';
import SageFullLogo from '@/public/branding/sage-full-logo.svg';
import CloseSVG from '@/public/interactive/close.svg';
import { BaseMedia } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import {
  OfferRequest,
  useCreateBuyOfferMutation,
  useDeleteBuyOfferMutation,
  useSellFromBuyOfferMutation,
} from '@/store/nftsReducer';
import LoaderSpinner from '@/components/LoaderSpinner';
import { useSession } from 'next-auth/react';
import { parameters } from '@/constants/config';
import { formatTimestampYYMMddHHmm } from '@/utilities/strings';

interface Props extends ModalProps {
  artist: User;
  nft: Nft_include_NftContractAndOffers;
  buyOffers: Offer[];
}

//@scss : '@/styles/components/_games-modal.scss'
export default function MakeOfferModal({ isOpen, closeModal, artist, nft, buyOffers }: Props) {
  const [amount, setAmount] = useState(nft.price!);
  const [createBuyOffer, { isLoading: isCreatingBuyOffer }] = useCreateBuyOfferMutation();
  const [sellFromBuyOffer, { isLoading: isSelling }] = useSellFromBuyOfferMutation();
  const [deleteBuyOffer] = useDeleteBuyOfferMutation();
  const { data: signer } = useSigner();
  const { data: sessionData } = useSession();
  const { data: walletBalance } = useBalance({
    token: parameters.ASHTOKEN_ADDRESS,
    addressOrName: sessionData?.address as string,
  });
  const isOwner = () => sessionData?.address == artist.walletAddress;

  async function handleDeleteClick(offerId: number) {
    deleteBuyOffer(offerId);
  }

  async function handleAcceptClick(offer: Offer) {
    const result = await sellFromBuyOffer({
      tokenId: nft.tokenId,
      offer,
      signer: signer as Signer,
    });
    if ((result as any).data) {
      closeModal();
    }
  }

  async function handleMakeOfferClick() {
    if (!signer || !sessionData) {
      toast.info('Please sign in with a wallet.');
      return;
    }
    if (amount < nft.price!) {
      toast.info(`Minimum offer for this piece is ${nft.price}`);
      return;
    }
    if (ethers.utils.parseEther(amount.toString()).gt(walletBalance?.value!)) {
      toast.warn(`Insufficient balance for this offer amount`);
      return;
    }
    await createBuyOffer({
      nftId: nft.id,
      tokenId: nft.tokenId,
      amount,
      signer: signer as Signer,
      nftContractAddress: nft.NftContract?.contractAddress,
    } as OfferRequest);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setAmount(+e.target.value);
  }

  useEffect(() => {
    // find highest offer
    var highestOffer = nft.price!;
    for (const o of nft.Offers) {
      if (o.state == OfferState.ACTIVE && o.price > highestOffer) {
        highestOffer = o.price;
      }
    }
    setAmount(highestOffer);
  }, [nft]);

  return (
    <Modal isOpen={isOpen} closeModal={closeModal}>
      <div className='games-modal'>
        <section className='games-modal__header'>
          <SageFullLogo className='games-modal__sage-logo' />
          <CloseSVG onClick={closeModal} className='games-modal__close-button' />
        </section>
        <section className='games-modal__body'>
          <div className='games-modal__main-img-container'>
            <BaseMedia src={nft.s3PathOptimized} fit='contain' />
          </div>
          <div className='games-modal__main-content'>
            <div>
              <h1 className='games-modal__drop-name'>by {artist.username}</h1>
              <h1 className='games-modal__game-name'>{nft.name}</h1>
            </div>
            {nft.description && (
              <p className='games-modal__game-description'>{nft.description}</p>
            )}
            <input
              onChange={handleInputChange}
              type='number'
              className='games-modal__bid-input'
              value={amount}
            />
            <div
              className='games-modal__game-description'
              style={{ textAlign: 'right', fontSize: '80%' }}
            >
              min offer: {nft.price} SAGE
            </div>
            <button
              disabled={isCreatingBuyOffer}
              className='games-modal__place-bid-button'
              onClick={handleMakeOfferClick}
            >
              {isCreatingBuyOffer ? <LoaderSpinner /> : 'BID'}
            </button>

            {isSelling && (
              <div style={{ textAlign: 'center', marginTop: '15px' }}>
                <LoaderSpinner />
              </div>
            )}

            <div>
              {buyOffers.length > 0 && (
                <table className='games-modal__offers-table'>
                  <thead>
                    <tr>
                      <th>from</th>
                      <th>expires</th>
                      <th>amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {buyOffers.map((o: Offer, i: number) => {
                      return (
                        <tr key={i} data-animate-first={true}>
                          <td>{shortenAddress(o.signer)}</td>
                          <td>{formatTimestampYYMMddHHmm(o.expiresAt)}</td>
                          <td>{o.price} SAGE</td>
                          <td>
                            <div>
                              {o.signer == sessionData?.address && (
                                <div className='games-modal__trash-icon'>
                                  <a onClick={() => handleDeleteClick(o.id)}>
                                    <img src='/icons/trash.svg' width='15' />
                                  </a>
                                </div>
                              )}
                              {isOwner() &&
                                (isSelling ? (
                                  ''
                                ) : (
                                  <div className='games-modal__trash-icon'>
                                    <a onClick={() => handleAcceptClick(o)}>
                                      <img src='/icons/check.svg' width='15' />
                                    </a>
                                  </div>
                                ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
