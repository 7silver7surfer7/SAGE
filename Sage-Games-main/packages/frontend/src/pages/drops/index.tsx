import React from 'react';
import useDropDown from '@/hooks/useDropDown';

function drops() {
  const { currentOption, setCurrentOption } = useDropDown(['Most Recent']);
  return (
    <div className='grid-page'>
      <section id='one'>
        <h1 id='header'>Drops</h1>
        <div id='filter'>
          <span>{currentOption}</span>
          <img src='/arrow-down.svg' alt='' />
        </div>
      </section>
      <section id='grid'></section>
    </div>
  );
}

export default drops;
