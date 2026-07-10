import React, { useState } from 'react';
import Image from 'next/image';
import Loader from 'react-loader-spinner';
import { useGetUserQuery } from '@/store/services/user';
import { useGetPrizesByUserQuery } from '@/store/services/prizesReducer';
import { useSession } from 'next-auth/react';
import shortenAddress from '@/utilities/shortenAddress';
import EditProfileModal from '@/components/Modals/EditProfileModal';
import { toast } from 'react-toastify';
import { GamePrize } from '@/prisma/types';

function profile() {
  const { data: sessionData } = useSession();
  const {
    data: userData,
    isFetching: isFetchingUser,
    isError: isFetchUserError,
  } = useGetUserQuery();
  const { data: prizeData } = useGetPrizesByUserQuery(sessionData?.address as string, {
    skip: !sessionData,
  });
  const [isEditModalOpen, setIsEditOpenModalOpen] = useState(false);
  if (!sessionData) {
    return <div className='profile-page'>sign in to view profile</div>;
  }
  if (!userData && isFetchingUser) {
    return (
      <div className='profile-page'>
        <br />
        <Loader type='ThreeDots' color='white' height={10} width={50} timeout={0} />
      </div>
    );
  }
  if (isFetchUserError) {
    return <div className='profile-page'>Error</div>;
  }

  //TODO: determine claimable nfts
  const hasClaimables = !!prizeData?.length;

  return (
    <div className='profile-page'>
      <EditProfileModal
        isOpen={isEditModalOpen}
        closeModal={() => setIsEditOpenModalOpen(false)}
        title='Edit Profile'
      />
      <div className='account-card'>
        <div className='account-card__content'>
          <div className='account-card__edit-container'>
            <button className='account-card__edit-btn' onClick={() => setIsEditOpenModalOpen(true)}>
              edit profile
            </button>
          </div>
          <div className='account-card__pfp'>
            <Image
              src={userData?.profilePicture || '/sample/pfp.svg'}
              layout='fill'
              objectFit='cover'
            />
          </div>
          <div className='account-card__name'>{userData?.displayName || 'name'}</div>
          <div className='account-card__handle'>{userData?.username || '@handle'}</div>
          <div className='account-card__bio'>{userData?.bio}</div>
          <div className='account-card__socials'>
            <div className='account-card__socials-icon'></div>
          </div>
        </div>
        <div className='account-card__private'>
          <h1 className='account-card__private-header'>private</h1>
          <div className='account-card__private-info'>
            <div
              className='account-card__private-info-address'
              onClick={() => {
                window.navigator.clipboard.writeText(sessionData?.address as string);
                toast.success('copied address');
              }}
            >
              {shortenAddress(userData?.walletAddress as string)}
            </div>
            {/*
            <div className='account-card__private-info-pina'>7021 ASH</div>
						*/}
          </div>
          <h1 className='account-card__private-email'>{userData?.email}</h1>
        </div>
      </div>
      <div className='collection'>
        <div className='collection__header'>
          My Collection
          {hasClaimables && (
            <div className='collection__claimable'>You have {prizeData?.length} NFTs to claim</div>
          )}
        </div>
        <div className='collection__grid'>
          {prizeData?.map((p: GamePrize) => {
            return (
              <div className='collection__tile'>
                <div className='collection__tile-img'>
                  <Image src={p.s3Path} layout='fill' objectFit='cover' />
                </div>
                <div className='collection__tile-details'>
                  <div className='collection__tile-artist-pfp'>
                    <Image src={p.artistProfilePicture} layout='fill' objectFit='cover' />
                  </div>
                  <div className='collection__tile-artist-info'>
                    <div className='collection__tile-nft-name'>{p.nftName}</div>
                    <div className='collection__tile-artist-name'>by {p.artistDisplayName}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default profile;
