import { useGetDropsPendingApprovalQuery } from '@/store/dropsReducer';
import LoaderDots from '../LoaderDots';
import NewDropCard from './NewDropCard';

export function NewDropsPanel() {
  const { data: drops, isFetching } = useGetDropsPendingApprovalQuery();
  if (isFetching) {
    return <LoaderDots />;
  }
  if (drops?.length == 0) {
    return (
      <div style={{ marginTop: '50px', marginLeft: '50px', color: '#6f676e' }}>
        No pending approvals.
      </div>
    );
  }
  return (
    <div className=''>
      <div className=''>
        <div className='dashboard__new-drops-grid'>
          {drops?.map((drop) => (
              <NewDropCard key={drop.id} drop={drop} />
          ))}
        </div>
      </div>
    </div>
  );
}
