import Loader from 'react-loader-spinner';

interface Props {
  pending: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}

export default function GetTicketsButton({ pending, onClick }: Props) {
  return (
    <button className='btn-get-tickets' disabled={pending} onClick={onClick}>
      {pending ? (
        <>
          <Loader type='TailSpin' color='white' height='20px' width='20px' /> Bidding...
        </>
      ) : (
        'Get Tickets'
      )}
    </button>
  );
}
