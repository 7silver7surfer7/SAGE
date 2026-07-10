import useModal from '@/hooks/useModal';
import useSageRoutes from '@/hooks/useSageRoutes';
import useWindowDimensions from '@/hooks/useWindowSize';

interface Props {
  toggleMobileMenu: ReturnType<typeof useModal>['toggleModal'];
  isOpen: boolean;
  isDynamicColors?: boolean;
}

export default function MenuToggle({ toggleMobileMenu, isOpen, isDynamicColors }: Props) {
  const { isMobile } = useWindowDimensions();
  const { isSingleDropsPage } = useSageRoutes();
  const dataBgColor = Boolean(isDynamicColors) && isSingleDropsPage && 'white';
  if (isMobile) {
    return (
      <div onClick={toggleMobileMenu} className='mobile-menu__toggle'>
        <div className='mobile-menu__toggle-inner'>
          <div
            data-bg-color={dataBgColor}
            className='mobile-menu__toggle-line1'
            data-is-open={isOpen}
          ></div>
          <div
            data-bg-color={dataBgColor}
            className='mobile-menu__toggle-line2'
            data-is-open={isOpen}
          ></div>
          <div
            data-bg-color={dataBgColor}
            className='mobile-menu__toggle-line3'
            data-is-open={isOpen}
          ></div>
        </div>
      </div>
    );
  }

  return null;
}
