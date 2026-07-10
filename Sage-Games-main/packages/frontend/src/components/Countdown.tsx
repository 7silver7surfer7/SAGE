import useCountdown from '@/hooks/useCountdown';
import { useEffect, useState } from 'react';

type Colors = 'purple';

interface Props {
  endTime: number | Date;
  color?: Colors;
}

export default function Countdown({ endTime, color }: Props) {
  const { days, hours, minutes, seconds, total } = useCountdown({ targetDate: endTime });
  const [displayValue, setDisplayValue] = useState<string>('');
  useEffect(() => {
    setDisplayValue(`${days * 24 + hours}h ${minutes}m ${seconds}s`);
  }, [total]);
  return (
    <div className='status__countdown' data-color={color}>
      {displayValue}
    </div>
  );
}
