import {
  basePathCreators,
  basePathDrops,
  basePathAuctions,
  basePathLotteries,
  basePathHome,
  basePathSubmissions,
  basePathProfile,
} from '@/constants/paths';
import { useRouter } from 'next/router';
import { User, Drop } from '@prisma/client';
import useProfileRoutes from './useProfileRoutes';

export default function useSageRoutes() {
  const router = useRouter();
  const { shallowRoute } = useProfileRoutes();

  async function pushToCreators(username?: User['username']) {
    if (username) {
      await router.push(basePathCreators + '/' + username);
    } else {
      await router.push(basePathCreators);
    }
  }

  async function pushToDrops(dropId?: Drop['id']) {
    if (dropId) {
      await router.push(basePathDrops + '/' + dropId);
    } else {
      await router.push(basePathDrops);
    }
  }

  async function pushToHome() {
    await router.push(basePathHome);
  }

  async function pushToSubmissions() {
    await router.push(basePathSubmissions);
  }

  async function pushToProfile() {
    await router.push(basePathProfile);
  }

  async function pushToCollection() {
    shallowRoute('2');
  }

  async function pushToMintCreation() {
    shallowRoute('3');
  }

  async function pushToHowToBuyAsh() {
    await router.push('/howtobuyash');
  }

  async function pushToPrivacyPolicy() {
    await router.push('/privacypolicy');
  }

  async function pushToTermsOfService() {
    await router.push('/termsofservice');
  }

  const { pathname } = router;

  const isProfilePage: boolean = pathname.includes(basePathProfile);
  const isSingleDropsPage: boolean = pathname.includes(basePathDrops + '/');
  const isCreatorsPage: boolean = pathname.includes(basePathCreators) && !pathname.includes('id');

  return {
    pushToCreators,
    pushToDrops,
    pushToHome,
    pushToSubmissions,
    pushToProfile,
    pushToHowToBuyAsh,
    pushToPrivacyPolicy,
    pushToTermsOfService,
    isProfilePage,
    isSingleDropsPage,
    isCreatorsPage,
    pushToMintCreation,
    pushToCollection,
  };
}
