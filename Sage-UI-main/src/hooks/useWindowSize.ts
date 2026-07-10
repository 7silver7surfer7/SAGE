import { useState, useEffect } from 'react';

function getWindowDimensions() {
  const { innerWidth: width, innerHeight: height } = window;
  return {
    width,
    height,
  };
}

interface State {
  width: number;
  height: number;
}

const INITIAL_STATE: State = { width: 0, height: 0 };
const BREAK_POINT: number = 1024;

export default function useWindowDimensions() {
  const [windowDimensions, setWindowDimensions] = useState<State>(INITIAL_STATE);
  const [isLandscape, setIsLandscape] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    function handleResize() {
      const dimensions = getWindowDimensions();
      setWindowDimensions(dimensions);

      if (dimensions.width < BREAK_POINT) {
        setIsMobile(true);
      } else {
        setIsMobile(false);
      }

      if (dimensions.width > dimensions.height) {
        setIsLandscape(true);
      } else {
        setIsLandscape(false);
      }
    }

    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return { windowDimensions, isMobile, isLandscape};
}
