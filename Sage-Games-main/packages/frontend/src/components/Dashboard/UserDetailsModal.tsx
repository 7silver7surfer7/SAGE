import { useGetPointsBalanceQuery } from '@/store/services/pointsReducer';
import Modal from '@/components/Modals';
import Loader from 'react-loader-spinner';

interface UserDetailsModalProps {
  isOpen: boolean;
  toggle: (isOpen: boolean) => void;
  userData: any;
}

export function UserDetailsModal({ isOpen, toggle, userData }: UserDetailsModalProps) {
  const { data: pointsBalance, isFetching: isFetchingPoints } = useGetPointsBalanceQuery(
    userData?.walletAddress,
    {
      skip: !userData,
    }
  );
  const lotteryIds = [],
    isFetchingLotteryIds = true;
  // const { data: lotteryIds, isFetching: isFetchingLotteryIds } = useGetParticipatingLotteryIdsQuery(
  //   userData?.walletAddress,
  //   {
  //     skip: !userData,
  //   }
  // );

  const numTickets = 0,
    isFetchingTickets = true;
  // const { data: numTickets, isFetching: isFetchingTickets } = useGetNumUserEntriesTotalQuery(
  //   userData?.walletAddress,
  //   {
  //     skip: !userData,
  //   }
  // );

  return (
    <div>
      <Modal title='' isOpen={isOpen} closeModal={() => toggle(isOpen)}>
        <div className='inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl'>
          <button onClick={() => toggle(isOpen)}>x</button>
          <div className='flex flex-col space-y-4 items-center'>
            {isFetchingPoints || isFetchingLotteryIds || isFetchingTickets ? (
              <Loader type='ThreeDots' color='black' height={10} width={50} timeout={0} />
            ) : (
              <div className='text-center'>
                <div className='mx-auto relative sm:w-20 sm:h-20 w-20 h-20 overflow-hidden rounded-full shadow-md bg-white border-1'>
                  <img src={userData?.profilePicture || '/sample/pfp.svg'} className='mx-auto' />
                </div>
                <div className='mt-2 font-bold'>{userData?.username}</div>
                <div>{userData?.email}</div>
                <div className='italic'>{userData?.bio}</div>
                <div className='font-mono'>{userData?.walletAddress}</div>
                <div className='mt-4 items-center flex justify-center space-x-8'>
                  <div>
                    <img src='/pineapple.svg' width='25' className='mx-auto' />
                    <div className='font-bold'>{userData?.EarnedPoints.totalPointsEarned}</div>
                    <div className='text-xs'>earned</div>
                  </div>
                  <div>
                    <img src='/pineapple.svg' width='25' className='mx-auto' />
                    <div className='font-bold'>{pointsBalance}</div>
                    <div className='text-xs'>balance</div>
                  </div>
                  <div>
                    <img src='/drop.svg' width='25' className='mx-auto' />
                    <div className='font-bold'>{lotteryIds?.length}</div>
                    <div className='text-xs'>lotteries</div>
                  </div>
                  <div>
                    <img src='/ticket.svg' width='25' className='mx-auto' />
                    <div className='font-bold'>{numTickets}</div>
                    <div className='text-xs'>tickets</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
