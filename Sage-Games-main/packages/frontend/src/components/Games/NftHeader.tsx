interface Props {
  nftName: string;
  numberOfEditions: number;
  dropName: string;
}

export default function NftHeader({ nftName, numberOfEditions, dropName }: Props) {
  return (
    <div className='nft__header'>
      <div className='nft__name'>{nftName}</div>
      <div className='nft__subheader'>
        <div className='nft__editions'>{numberOfEditions} editions</div>
        <div className='nft__divider'>•</div>
        <div className='nft__drop-name'>{dropName}</div>
      </div>
    </div>
  );
}
