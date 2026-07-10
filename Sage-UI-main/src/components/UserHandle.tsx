import { useGetUserQuery } from '@/store/usersReducer';
import shortenAddress from '@/utilities/shortenAddress';
import { useSession } from 'next-auth/react';

export default function UserHandle() {
  const { data: sessionData, status: sessionStatus } = useSession();
  const { data: userData } = useGetUserQuery(undefined, {
    skip: !sessionData,
  });
  // NOTE: this used to resolve an ENS name via wagmi's useEnsName, but
  // Robinhood Chain has no ENS registry, so the lookup threw an unhandled
  // "resolver or addr is not configured for ENS name" error on every
  // signed-in page. Restore it only if the app returns to an ENS chain.

  /*
	component should never show if user is not securely authenticated;
	*/
  if (sessionStatus !== 'authenticated') return null;

  /*
	priority order:
	1) username, if available
	2) shortened address i.e. 0X...02DF
	3) 'error' string;
	*/
  const userHandle =
    userData?.username ?? shortenAddress(sessionData?.address as string) ?? 'error';

  return (
    <span data-is-ens={false} className='user-handle'>
      {userHandle}
    </span>
  );
}
