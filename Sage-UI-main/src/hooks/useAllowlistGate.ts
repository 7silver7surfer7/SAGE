import { useCheckDropAllowlistQuery } from '@/store/dropsReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

/**
 * "Is this drop gated, and may the connected wallet buy?"
 *
 * Fires a light per-wallet check for signed-in users (the API reads the wallet
 * from the JWT, so it can't be spoofed); ungated drops answer {gated:false,
 * allowed:true}. Anonymous visitors resolve allowed=true here because every
 * purchase flow already forces sign-in first — the drop page's static
 * allowlistEnabled flag handles their "allowlist only" badge instead.
 *
 * For open editions and drawings the chain enforces the list anyway — this
 * gate is UX. For auction bids it is the only gate.
 */
export default function useAllowlistGate(dropId: number | null | undefined) {
  const { isSignedIn } = useSAGEAccount();
  const { data, isFetching } = useCheckDropAllowlistQuery(dropId as number, {
    skip: !isSignedIn || !dropId,
  });
  return {
    gated: data?.gated ?? false,
    // blocked only when we KNOW the drop is gated and the wallet isn't on it
    allowed: data ? data.allowed : true,
    isChecking: isFetching,
  };
}
