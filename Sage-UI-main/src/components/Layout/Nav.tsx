import useSageRoutes from '@/hooks/useSageRoutes';
import { DEX_ENABLED } from '@/constants/config';
import { useRouter } from 'next/router';
import { useGetUserQuery } from '@/store/usersReducer';
import { useSession } from 'next-auth/react';
import Connect from '../Connect';
import { PfpImage } from '../Media/BaseMedia';
import PersonalizedMessage from '../PersonalizedMessage';
import ProfileDisplay from '../ProfileDisplay';
import { SearchInput } from '../SearchInput';
interface NavLink {
  name: string;
  routeFunction: () => any;
}

export default function Nav() {
  const {
    pushToDrops,
    pushToHome,
    pushToTokens,
    pushToDex,
    pushToAgentApi,
    pushToHowToBuyAsh,
    pushToSocial,
    isProfilePage,
    isSingleDropsPage,
    pushToProfile,
  } = useSageRoutes();
  const { data: sessionData, status: sessionStatus } = useSession();
  const { data: userData } = useGetUserQuery(undefined, {
    skip: !sessionData,
  });
  const isSignedIn: boolean = sessionStatus === 'authenticated';
  const shouldShowPersonal: boolean = !isProfilePage;
  const { pathname } = useRouter();
  // the legacy marketplace search is redundant on SAGE Social (it has its own)
  const isSocialSurface = pathname.startsWith('/social') || pathname.startsWith('/invite');
  const shouldShowSearch: boolean = !isProfilePage && !isSocialSurface;
  const dataColor: string = isSingleDropsPage && 'white';

  const navLinks: NavLink[] = [
    {
      name: 'Home',
      routeFunction: pushToHome,
    },
    {
      name: 'Drops',
      routeFunction: pushToDrops,
    },
    {
      name: 'Social',
      routeFunction: () => pushToSocial(),
    },
    {
      name: 'Tokens',
      routeFunction: pushToTokens,
    },
    // flag-gated: the DEX product ships dark unless the build enables it
    ...(DEX_ENABLED
      ? [
          {
            name: 'DEX',
            routeFunction: pushToDex,
          },
        ]
      : []),
    {
      name: 'Agent API',
      routeFunction: pushToAgentApi,
    },
    {
      name: 'SAGE Token',
      routeFunction: pushToHowToBuyAsh,
    },
  ];

  return (
    <div className='nav__wrapper'>
      <div className='nav' data-color={dataColor} data-cy='nav'>
        <div className='nav__content'>
          {/* always rendered — an equal-flex spacer column that mirrors
              .nav__personal so the menu stays centered. Omitting this box
              entirely on /social (where the search itself is redundant)
              collapsed the row to two columns and shoved the menu left. */}
          <div className='nav__search'>
            {shouldShowSearch && (
              <div className='nav__search-wrapper'>
                <div className='searchform'>
                  <SearchInput
                    placeholder='search sage'
                    className='searchform__input'
                    displayIcon={true}
                    dataColor={dataColor}
                  />
                </div>
              </div>
            )}
          </div>
          <div className='nav__menu'>
            {navLinks.map(({ name, routeFunction }: NavLink) => {
              function onClick() {
                routeFunction();
              }

              return (
                <button
                  key={name}
                  data-name={name}
                  onClick={onClick}
                  className='nav__menu-link'
                >
                  {name}
                </button>
              );
            })}
          </div>
          {/* always rendered — see .nav__search above: omitting this box
              entirely (e.g. on /profile, where shouldShowPersonal is false)
              left search as the only flex:1 column, which grew to fill all
              remaining space and shoved the centered menu to the far right. */}
          <div className='nav__personal'>
            {shouldShowPersonal &&
              (isSignedIn ? (
                <>
                  <ProfileDisplay />
                </>
              ) : (
                <Connect></Connect>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
