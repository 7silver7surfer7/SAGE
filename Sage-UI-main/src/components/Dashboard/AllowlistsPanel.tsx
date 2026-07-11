import { useState } from 'react';
import {
  useGetApprovedDropsQuery,
  useGetDropsPendingApprovalQuery,
} from '@/store/dropsReducer';
import LoaderDots from '@/components/LoaderDots';
import { AllowlistModal } from './AllowlistModal';

/**
 * One place to manage every drop's allowlist — drafts AND deployed drops.
 * (New Drops only shows unapproved drops, so this tab is the editing surface
 * for adding addresses to a drop that's already live.)
 */
export function AllowlistsPanel() {
  const { data: approved, isFetching: fetchingApproved } = useGetApprovedDropsQuery();
  const { data: pending, isFetching: fetchingPending } = useGetDropsPendingApprovalQuery();
  const [editing, setEditing] = useState<{ id: number; name: string; deployed: boolean } | null>(
    null
  );

  if (fetchingApproved || fetchingPending) return <LoaderDots />;

  const rows = [
    ...(pending || []).map((d) => ({ drop: d, deployed: false })),
    ...(approved || []).map((d) => ({ drop: d, deployed: true })),
  ];

  return (
    <div className='dashboard__allowlists'>
      <table className='dashboard__table' style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #8884' }}>
            <th style={{ padding: '8px' }}>drop</th>
            <th style={{ padding: '8px' }}>status</th>
            <th style={{ padding: '8px' }}>allowlist</th>
            <th style={{ padding: '8px' }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ drop, deployed }) => (
            <tr key={drop.id} style={{ borderBottom: '1px solid #8882' }}>
              <td style={{ padding: '8px' }}>
                #{drop.id} — {drop.name}
              </td>
              <td style={{ padding: '8px' }}>{deployed ? 'deployed' : 'draft'}</td>
              <td style={{ padding: '8px' }}>
                {(drop as any).allowlistEnabled ? 'gated' : 'open'}
              </td>
              <td style={{ padding: '8px' }}>
                <button
                  className='dashboard__submit-button'
                  style={{ height: '36px', padding: '0 18px' }}
                  onClick={() => setEditing({ id: drop.id, name: drop.name, deployed })}
                >
                  edit
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td style={{ padding: '8px' }}>no drops yet</td>
            </tr>
          )}
        </tbody>
      </table>
      {editing && (
        <AllowlistModal
          isOpen={true}
          closeModal={() => setEditing(null)}
          dropId={editing.id}
          dropName={editing.name}
          deployed={editing.deployed}
        />
      )}
    </div>
  );
}
