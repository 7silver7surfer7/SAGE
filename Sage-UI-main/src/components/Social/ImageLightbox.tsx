import { Dialog } from '@headlessui/react';
import { animated, useTransition } from 'react-spring';
import CloseSVG from '@/public/interactive/close.svg';

interface Props {
  src: string | null;
  onClose: () => void;
}

/** Twitter-style fullscreen image viewer: near-black backdrop, the image
 *  centered at its true aspect ratio (never cropped), a close button fixed
 *  to the corner. Separate from the boxed-card `Modal` (@/components/Modals)
 *  — that one centers a content panel with padding/background; this is
 *  meant to BE the content, edge to edge. */
export default function ImageLightbox({ src, onClose }: Props) {
  const isOpen = !!src;
  const transition = useTransition(isOpen, {
    from: { opacity: 0 },
    enter: { opacity: 1 },
    leave: { opacity: 0 },
  });
  return transition(
    (props, show) =>
      show && (
        <Dialog open={show} onClose={onClose} as='div' className='image-lightbox'>
          <animated.div style={props} className='image-lightbox__backdrop' aria-hidden='true' onClick={onClose} />
          <animated.div style={props} className='image-lightbox__container'>
            <button className='image-lightbox__close' onClick={onClose} aria-label='Close'>
              <CloseSVG />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src || ''} alt='' className='image-lightbox__img' onClick={(e) => e.stopPropagation()} />
          </animated.div>
        </Dialog>
      )
  );
}
