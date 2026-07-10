import Logotype from '@/components/Logotype';
import { BaseMedia } from '@/components/Media/BaseMedia';
import { useRouter } from 'next/router';
import X404 from '@/public/branding/404.svg';
import Y404 from '@/public/branding/404-y.svg';
import useWindowDimensions from '@/hooks/useWindowSize';

export default function Custom404() {
  const { isMobile } = useWindowDimensions();
  const router = useRouter();
  function handle404Click() {
    router.push('/');
  }
  return (
    <div className='custom404'>
      <div className='custom404__logotype-container'>
        <Logotype isErrorPage />
      </div>
      <h1 className='custom404__catchphrase'>404 you broke the seal</h1>
      {isMobile ? (
        <Y404 onClick={handle404Click} className='custom404__404logo' />
      ) : (
        <X404 onClick={handle404Click} className='custom404__404logo' />
      )}
    </div>
  );
}
