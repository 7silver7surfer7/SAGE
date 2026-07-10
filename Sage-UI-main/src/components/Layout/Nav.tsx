import useSageRoutes from '@/hooks/useSageRoutes';
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
    pushToSubmissions,
    pushToAgentApi,
    pushToHowToBuyAsh,
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
  const shouldShowSearch: boolean = !isProfilePage;
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
      name: 'Apply',
      routeFunction: pushToSubmissions,
    },
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
          {shouldShowSearch && (
            <div className='nav__search'>
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
            </div>
          )}
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
          {shouldShowPersonal && (
            <div className='nav__personal'>
              {isSignedIn ? (
                <>
                  <ProfileDisplay />
                </>
              ) : (
                <Connect></Connect>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
