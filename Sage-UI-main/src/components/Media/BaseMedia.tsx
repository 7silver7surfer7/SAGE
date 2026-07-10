import { DEFAULT_PROFILE_PICTURE } from '@/constants/config';
import DEFAULT_PFP from '@/public/branding/sage-icon.svg';
import Image, { ImageProps } from 'next/image';
import Zoom from 'react-medium-image-zoom';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { isVideoSrc, videoPlaybackSrc } from '@/utilities/media';
// video.js is ~200 kB minified; load it only when a video actually renders
const VideoJS = dynamic(() => import('./VideoJS'), { ssr: false });

const MAX_MEDIA_RETRIES = 3;
const MEDIA_RETRY_DELAY_MS = 1500;

/**
 * Arweave serves content through a load-balanced pool of gateway edge nodes.
 * A freshly-uploaded file is sometimes routed to a node that hasn't finished
 * propagating it yet (or is having a bad moment), which can 200 with an error
 * page instead of the real bytes. The data itself is safe (mined on-chain) —
 * a retry against a cache-busted URL usually lands on a healthy node.
 */
function useRetryableSrc(src: string | null | undefined) {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [src]);
  const onError = useCallback(() => {
    setAttempt((a) => (a < MAX_MEDIA_RETRIES ? a + 1 : a));
  }, []);
  const [effectiveSrc, setEffectiveSrc] = useState(src);
  useEffect(() => {
    if (attempt === 0 || !src) {
      setEffectiveSrc(src);
      return undefined;
    }
    const timer = setTimeout(() => {
      const sep = src.includes('?') ? '&' : '?';
      setEffectiveSrc(`${src}${sep}retry=${attempt}`);
    }, MEDIA_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [attempt, src]);
  return { src: effectiveSrc, onError };
}

const ConditionalWrapper = ({ condition, wrapper, children }) =>
  condition ? wrapper(children) : children;

interface BaseMediaProps extends Partial<ImageProps> {
  src: string;
  onClickHandler?: React.MouseEventHandler<HTMLImageElement>;
  isZoomable?: boolean;
  type?: string;
  className?: string;
  muted?: boolean;
  autoPlay?: boolean;
  /** 'cover' (default) crops to fill the container — right for grid tiles;
   *  'contain' letterboxes so the WHOLE artwork is visible at its true
   *  aspect ratio — right for detail/mint/bid modals. */
  fit?: 'cover' | 'contain';
}

function BaseMedia({
  src,
  autoPlay,
  onClickHandler,
  isZoomable,
  type,
  className,
  muted,
  priority,
  fit = 'cover',
}: BaseMediaProps) {
  const isVideo = (): boolean => isVideoSrc(src);
  const retryable = useRetryableSrc(src);

  const videoMustStartMuted = () => {
    if (typeof window !== 'undefined') {
      const ua = window.navigator.userAgent.toLowerCase();
      const isFirefox = ua.indexOf('firefox') > -1;
      const isBrave = ua.indexOf('brave') > -1;
      const isSafari = ua.indexOf('safari') > -1;
      return isFirefox || isBrave || isSafari;
    }
    return false;
  };

  const videoJsOptions = isVideo()
    ? {
        autoplay: true,
        controls: false,
        controlslist: 'nodownload',
        loop: true,
        playsinline: true,
        preload: 'metadata',
        muted: videoMustStartMuted(),
        // poster: 'https://d180qjjsfkqvjc.cloudfront.net/trailers/lehel_poster.png',
        sources: [
          {
            // proxied through /api/media for real 206 range support — Safari
            // refuses to play video from arweave.net's range-less gateway
            src: videoPlaybackSrc(src),
            type: 'video/mp4',
          },
        ],
      }
    : {};

  return (
    <div>
      <ConditionalWrapper
        condition={true === isZoomable && !isVideo()}
        wrapper={(children: JSX.Element) => <Zoom classDialog='custom-zoom'>{children}</Zoom>}
      >
        {isVideo() ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              objectFit: fit,
              overflow: 'hidden',
            }}
          >
            <VideoJS options={videoJsOptions} onReady={() => {}} fit={fit} />
          </div>
        ) : isZoomable ? (
          <img
            src={retryable.src}
            onError={retryable.onError}
            // layout='fill'
            style={{
              overflow: 'hidden',
              width: '100%',
              height: '100%',
              objectFit: fit,
            }}
            draggable={false}
            className={className}
          />
        ) : (
          <Image
            src={retryable.src}
            onError={retryable.onError}
            priority={priority}
            layout='fill'
            objectFit={fit}
            draggable={false}
            className={className}
            onClick={onClickHandler}
            style={onClickHandler ? { cursor: 'pointer' } : {}}
          />
        )}
      </ConditionalWrapper>
    </div>
  );
}
interface PfpImageProps {
  src: string | null | undefined;
  className?: string;
}

function PfpImage({ src, className }: PfpImageProps) {
  const retryable = useRetryableSrc(src);
  if (!src) {
    // return <Image src={DEFAULT_PROFILE_PICTURE} className={className || 'default-pfp-src'} layout='fill' objectFit='cover' />;
    return (
      <DEFAULT_PFP className={className || 'default-pfp-src'} layout='fill' objectfit='cover' />
    );
  }
  return (
    <Image
      src={retryable.src}
      onError={retryable.onError}
      layout='fill'
      className={className}
      objectFit='cover'
    />
  );
}

export { BaseMedia, PfpImage };
