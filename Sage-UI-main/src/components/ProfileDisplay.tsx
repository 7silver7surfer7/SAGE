import useSageRoutes from '@/hooks/useSageRoutes';
import { useGetUserQuery } from '@/store/usersReducer';
import React from 'react';
import { PfpImage } from './Media/BaseMedia';

interface Props {
  /** called after navigating to the profile page — pass closeModal when this
   *  renders inside an overlay (mobile menu, wallet modal) so it doesn't stay
   *  open on top of the page it just navigated to */
  onNavigate?: () => void;
}

function ProfileDisplay({ onNavigate }: Props) {
  const { data: userData } = useGetUserQuery();
  const { pushToProfile } = useSageRoutes();
  function handleClick() {
    pushToProfile();
    onNavigate?.();
  }
  return (
    <div className='profile-page__pfp-section' onClick={handleClick}>
      <div className='profile-page__pfp-container'>
        <PfpImage src={userData?.profilePicture}></PfpImage>
      </div>
      <div className='profile-page__pfp-section-right'>
        <p className='profile-page__pfp-section-username'>{userData?.username || 'anonymous'}</p>
        <p className='profile-page__pfp-section-role'>
          {userData?.role && userData.role !== 'USER' ? userData.role : 'PROFILE'}
        </p>
      </div>
    </div>
  );
}

export default ProfileDisplay;
