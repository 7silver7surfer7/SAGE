import { toast } from 'react-toastify';
import { useGetMyInvitesQuery } from '@/store/socialReducer';

/**
 * "Refer friends" card (own profile): SAGE Social sign-ups are invite-gated,
 * so these codes ARE the growth loop. Each code links to /invite/{code},
 * whose OG image is a SAGE-styled card — sharing to X shows a rich preview.
 */
export default function ReferCard() {
  const { data } = useGetMyInvitesQuery();
  if (!data?.invites.length) return null;

  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  };
  const tweet = (url: string) => {
    const text = encodeURIComponent(
      `I have an invite to SAGE Social — the wallet-native art network. Tips, collects and boosts in $SAGE.\n\n${url}`
    );
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
  };

  return (
    <div className='social-refer'>
      <div className='social-refer__head'>
        <span className='social-refer__icon'>
          <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
            <path d='M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' />
            <circle cx='8.5' cy='7' r='4' />
            <path d='M20 8v6M23 11h-6' />
          </svg>
        </span>
        <div>
          <h4>Refer friends</h4>
          <p>SAGE Social is invite-only — your codes are the way in.</p>
        </div>
      </div>
      {data.invites.map((inv) => (
        <div key={inv.code} className='social-refer__row'>
          <code className='social-refer__code'>{inv.code}</code>
          <span className='social-refer__uses'>
            {inv.maxUses - inv.uses}/{inv.maxUses} left
          </span>
          <button className='social-refer__btn' onClick={() => copy(inv.url, 'Invite link')}>
            Copy link
          </button>
          <button className='social-refer__btn social-refer__btn--x' onClick={() => tweet(inv.url)}>
            Share on 𝕏
          </button>
        </div>
      ))}
    </div>
  );
}
