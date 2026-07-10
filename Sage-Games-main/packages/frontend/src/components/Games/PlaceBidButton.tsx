import Loader from 'react-loader-spinner';

interface Props {
  pending: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}

export default function PlaceBidButton({ pending, onClick }: Props) {
  return (
    <button className='btn-place-bid' disabled={pending} onClick={onClick}>
      {pending ? (
        <>
          <Loader type='TailSpin' color='white' height='20px' width='20px' /> Bidding...
        </>
      ) : (
        'Place bid'
      )}
    </button>
  );
}
