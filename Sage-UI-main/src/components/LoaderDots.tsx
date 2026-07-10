import useTheme from '@/hooks/useTheme';
import Loader from 'react-loader-spinner';

export default function LoaderDots() {
  const { theme } = useTheme();
  return (
    <div style={{ margin: '25px auto 25px' }}>
      <Loader type='ThreeDots' color={theme == 'dark' ? 'white' : 'black'} height={10} width={50} timeout={0} />
    </div>
  );
}
