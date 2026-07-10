import { useEffect, useRef } from 'react';

export default function useCursor() {
  const cursorEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const body = document.body;

    body.addEventListener('mousemove', (e) => {
      const dataX = String(e.pageX);
      const dataY = String(e.pageY);
      cursorEl.current?.setAttribute(
        'style',
        `transform: translate3d(${dataX}px, ${dataY}px, 0px);`
      );
    });
  }, []);

  return { cursorEl };
}
