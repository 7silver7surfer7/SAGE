import React from 'react';

interface Props {
  dataColor?: string;
}

export default function Motto({ dataColor }: Props) {
  return (
    <div className='motto'>
      SAGE<sup className='motto__super'>™</sup>️ - ACCELERATING WEB3
    </div>
  );
}
