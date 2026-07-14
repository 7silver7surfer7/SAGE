import { DEFAULT_PROFILE_PICTURE } from '@/constants/config';
import DEFAULT_PFP from '@/public/branding/sage-icon.svg';
import Image, { ImageProps } from 'next/image';
import Zoom from 'react-medium-image-zoom';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState, CSSProperties } from 'react';
import { arweaveProxySrc, isVideoSrc, videoPlaybackSrc, videoPosterSrc } from '@/utilities/media';
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
  // Images route through the same resilient /api/media proxy as video (gateway
  // retries + caching) — a banner or artwork image can 404 for hours on a
  // stale Arweave edge node exactly like an unpatched video used to.
  const retryable = useRetryableSrc(arweaveProxySrc(src));

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
        // first-frame still (a few KB) painted immediately while the video
        // itself loads — the tile shows the artwork instantly instead of a
        // blank/black box until metadata arrives
        poster: videoPosterSrc(src),
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
            {/* video.js preventDefault()s a tap's touchend ("Don't let browser
                turn this into a click"), so on touch devices taps on the video
                never become clicks and ancestor onClick handlers (artwork tiles
                routing to a drop) never fire. This transparent layer catches
                the tap instead — video.js's listeners aren't in its event path
                — and the browser synthesizes a normal bubbling click. Our
                videos never show controls, so covering them costs nothing.
                NOTE: it anchors to the nearest positioned ancestor (the tile),
                same as the absolutely-positioned <video> itself — do not make
                the wrapper above position:relative or both will clip to its
                zero-height box. */}
            <div
              onClick={onClickHandler}
              style={{ position: 'absolute', inset: 0 }}
            />
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
  const retryable = useRetryableSrc(arweaveProxySrc(src));
  // next/image's legacy layout='fill' renders the <img> as position:absolute;
  // inset:0 with NO wrapper of its own — it relies on the nearest POSITIONED
  // ancestor to size it. Every call site across the app is expected to
  // remember `position: relative` on its container, and several didn't (the
  // pump.fun token cards, bid history rows) — the image then escaped to the
  // page's static root and rendered full-viewport-sized (the "gradient
  // covering the whole screen" reports: it was a DiceBear avatar blown up).
  // Wrapping here guarantees a sized positioning context always exists,
  // regardless of what the caller's CSS does.
  const wrapperStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'block',
  };
  if (!src) {
    return (
      <span style={wrapperStyle}>
        <DEFAULT_PFP className={className || 'default-pfp-src'} layout='fill' objectfit='cover' />
      </span>
    );
  }
  return (
    <span style={wrapperStyle}>
      <Image
        src={retryable.src}
        onError={retryable.onError}
        layout='fill'
        className={className}
        objectFit='cover'
      />
    </span>
  );
}

export { BaseMedia, PfpImage };
