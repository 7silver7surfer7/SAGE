import React from 'react';
import Logotype from '@/components/Logotype';
import ArtistAgreement from '@/components/Documents/ArtistAgreement';

function agreement() {
  return (
    <div className='submissions-page'>
      <div className='submissions-page__logotype-container'>
        <Logotype></Logotype>
      </div>
      <section className='submissions-page__main'>
        <div className='submissions-page__main-left'>
          <ArtistAgreement></ArtistAgreement>
        </div>
      </section>
    </div>
  );
}

export default agreement;
