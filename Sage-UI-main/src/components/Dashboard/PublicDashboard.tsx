import useSAGEAccount from '@/hooks/useSAGEAccount';
import {
  usePromoteUserToAdminMutation,
  usePromoteUserToArtistMutation,
} from '@/store/dashboardReducer';
import { Signer } from 'ethers';
import React, { useState } from 'react';
import { toast } from 'react-toastify';
import LoaderSpinner from '../LoaderSpinner';

interface State {
  inputAddress: string;
}

const INITIAL_STATE: State = { inputAddress: '' };

function PublicDashboard() {
  const [promoteUserToArtist, { isLoading: isPromotingToArtist }] =
    usePromoteUserToArtistMutation();
  const [promoteUserToAdmin, { isLoading: isPromotingToAdmin }] = usePromoteUserToAdminMutation();
  const { signer, walletAddress } = useSAGEAccount();

  const [state, setState] = useState<State>(INITIAL_STATE);

  async function handlePromoteToArtistClick(walletAddress: string) {
    if (confirm(`Confirm promoting ${walletAddress} to ARTIST?`)) {
      await promoteUserToArtist({ walletAddress, signer: signer as Signer });
    }
  }

  async function handlePromoteToAdminClick(walletAddress: string) {
    if (confirm(`Confirm promoting ${walletAddress} to ADMIN?`)) {
      await promoteUserToAdmin({ walletAddress, signer: signer as Signer });
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setState((prevState) => {
      return { ...prevState, inputAddress: e.target.value };
    });
  }

  return (
    <div className='public-dashboard'>
      <p className='public-dashboard__input-label'>
        <span>CONNECTED WALLET: </span>
        <mark>{walletAddress}</mark>
      </p>
      <fieldset
        disabled={isPromotingToAdmin || isPromotingToArtist}
        className='public-dashboard__action-group'
      >
        <p className='public-dashboard__input-label'>MANAGE ADMIN ROLES</p>
        <input
          type='text'
          className='public-dashboard__input'
          value={state.inputAddress}
          onChange={handleInputChange}
          placeholder='TARGET WALLETADDRESS'
        />
        <button
          className='public-dashboard__button'
          data-type='promote'
          onClick={() => handlePromoteToAdminClick(state.inputAddress)}
        >
          {isPromotingToAdmin ? <LoaderSpinner></LoaderSpinner> : 'PROMOTE TO ADMIN'}
        </button>

        <button
          className='public-dashboard__button'
          data-type='promote'
          onClick={() => handlePromoteToArtistClick(state.inputAddress)}
        >
          {isPromotingToArtist ? <LoaderSpinner></LoaderSpinner> : 'PROMOTE TO ARTIST'}
        </button>
        <button className='public-dashboard__button' disabled>
          DEMOTE
        </button>
      </fieldset>

      {/* <fieldset disabled={isPromotingToArtist} className='public-dashboard__action-group'>
        <p className='public-dashboard__input-label'>MANAGE ARTIST ROLES</p>
        <input
          type='text'
          className='public-dashboard__input'
          placeholder='DESIGNATED ARTIST WALLETADDRESS'
        />
        <button
          className='public-dashboard__button'
          data-type='promote'
          onClick={() => {
            handlePromoteToArtistClick();
          }}
        >
          PROMOTE
        </button>
        <button className='public-dashboard__button'>DEMOTE</button> */}
      {/* </fieldset> */}
    </div>
  );
}

export default PublicDashboard;
