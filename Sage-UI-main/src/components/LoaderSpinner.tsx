import useTheme from '@/hooks/useTheme';
import Loader from 'react-loader-spinner';

export default function LoaderSpinner() {
  const { theme } = useTheme();

  return <Loader type='TailSpin' color={theme == 'dark' ? 'white' : 'black'} height='20px' width='20px' />;
}
