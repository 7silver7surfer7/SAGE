import { useGetDropsPendingApprovalQuery } from '@/store/services/dropsReducer';
import Loader from 'react-loader-spinner';
import NewDropCard from './NewDropCard';

export function NewDropsPanel() {
  const { data: drops, isFetching } = useGetDropsPendingApprovalQuery();
  if (isFetching) {
    return (
      <div style={{ margin: '25px' }}>
        <br />
        <Loader type='ThreeDots' color='white' height={10} width={50} timeout={0} />
      </div>
    );
  }
  return (
    <>
      <div
        className='games__grid'
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: '20px',
          textAlign: 'center',
          margin: '25px',
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        {drops?.map((drop) => (
          <NewDropCard key={drop.id} drop={drop} />
        ))}
      </div>
    </>
  );
}
