import Discord from '@/public/socials/discord.svg';
import Twitter from '@/public/socials/twitter.svg';

import React from 'react';

export default function Socials() {
  return (
    <div className='socials'>
      <a target='_blank' href='https://discord.gg/8YbCNpW5Y9'>
        <Discord className='socials__icon' />
      </a>
      <a target='_blank' href='https://x.com/sageartxyz'>
        <Twitter className='socials__icon' />
      </a>
    </div>
  );
}
