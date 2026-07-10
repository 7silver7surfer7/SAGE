import React from 'react';

interface Props {
  ref: React.MutableRefObject<HTMLDivElement>;
}

export default function Cursor({ ref }: Props) {
  return <div ref={ref} className='cursor'></div>;
}
