import { basePathProfile } from '@/constants/paths';
import { useRouter } from 'next/router';

export default function useProfileRoutes() {
  const router = useRouter();
  function shallowRoute(tab: string, subtab?: string) {
    const query = subtab ? { tab, subtab } : { tab };
    router.push(
      {
        pathname: basePathProfile,
        query,
      },
      undefined,
      { shallow: true }
    );
  }

  return { shallowRoute };
}
