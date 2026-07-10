import { useEffect, useState } from 'react';

interface UseCountdownArgs {
  targetDate: number | Date;
}

function checkTime(i: number) {
  let value: string = String(i);
  if (i < 10) {
    value = String('0' + value);
  }

  return value;
}

const useCountdown = ({ targetDate }: UseCountdownArgs) => {
  const countDownDate = new Date(targetDate).getTime();

  // null until mounted: the remaining time depends on "now", which differs
  // between the server render and client hydration — computing it in the
  // initial state breaks hydration ("Text content does not match").
  const [countDown, setCountDown] = useState<number | null>(null);

  useEffect(() => {
    setCountDown(countDownDate - Date.now());
    const interval = setInterval(() => {
      setCountDown(countDownDate - Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [countDownDate]);

  return getReturnValues(countDown);
};

const getReturnValues = (countDown: number | null) => {
  if (countDown === null) {
    // deterministic placeholder: identical on server and first client render
    return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0, displayValue: '--:--:--' };
  }
  // calculate time left
  const days = Math.floor(countDown / (1000 * 60 * 60 * 24));
  const hours = Math.floor((countDown % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((countDown % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((countDown % (1000 * 60)) / 1000);
  const total = countDown;

  let h = checkTime(days * 24 + hours);
  let m = checkTime(minutes);
  let s = checkTime(seconds);

  const displayValue = `${h}:${m}:${s}`;

  return { days, hours, minutes, seconds, total, displayValue };
};

export default useCountdown;
