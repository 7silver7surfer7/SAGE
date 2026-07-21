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
  // `type` is an explicit hint (e.g. Nft.mediaType) for hosts with no file
  // extension to sniff — a Filebase/IPFS gateway URL is just a CID, so
  // isVideoSrc's pattern match alone can't tell a video from an image there.
  const isVideo = (): boolean => type === 'video' || isVideoSrc(src);
  // Images route through the same resilient /api/media proxy as video (gateway
  // retries + caching) — a banner or artwork image can 404 for hours on a
  // stale Arweave edge node exactly like an unpatched video used to.
  const retryable = useRetryableSrc(arweaveProxySrc(src));

  // 'contain' callers (mint/bid modal artwork) want the WHOLE image visible
  // at its true proportions — but their container is a fixed CSS box sized
  // for one reference image. A wide/landscape piece inside that box just
  // gets letterboxed (large empty bars top/bottom) even though the image
  // itself now correctly fills its box (see the isZoomable <img> below).
  // Measuring the real image once it loads and sizing THIS wrapper to match
  // lets the box adapt per-artwork instead of forcing every image into one
  // shape. Scoped to fit==='contain' only — 'cover' grid tiles (fixed tile
  // aspect ratio, cropping is the point) must keep their own fixed shape.
  // starts square (a neutral placeholder — BaseMedia has no idea what shape
  // any given caller's artwork will turn out to be) so there's always a
  // real, non-zero box to paint into before the image loads and its true
  // ratio is measured, instead of collapsing to 0 height for that first frame.
  const [naturalRatio, setNaturalRatio] = useState(1);
  useEffect(() => setNaturalRatio(1), [src]);
  // Video artwork needs the exact same treatment: without it,
  // .games-modal__main-img-container (height:auto, relying on ITS child to
  // establish real height) and this wrapper's height:100% (relying on the
  // PARENT for height) never resolve — the container collapses to 0 and the
  // video renders inside an invisible box. This case was never exercised
  // before video detection worked in these modals, so the gap stayed latent.
  const adaptsToImage = fit === 'contain' && isZoomable;

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
    // position:relative gives the isZoomable <img> below (position:absolute;
    // inset:0) a guaranteed LOCAL anchor — without it, an unstyled caller
    // (no position on its own wrapper either) would send that img hunting
    // further up the tree for the nearest positioned ancestor, up to and
    // including none at all (full-page blowup — the exact "gradient
    // covering the whole screen" bug PfpImage's own comment describes).
    // adaptsToImage: height:100% is dropped in favor of the measured
    // aspect-ratio (once known) so this box matches the real artwork
    // instead of stretching to fill its parent's own fixed-ratio height.
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: adaptsToImage ? undefined : '100%',
        aspectRatio: adaptsToImage ? String(naturalRatio) : undefined,
      }}
    >
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
            <VideoJS
              options={videoJsOptions}
              onReady={
                adaptsToImage
                  ? (player) => {
                      const measure = () => {
                        const w = player.videoWidth();
                        const h = player.videoHeight();
                        if (w && h) setNaturalRatio(w / h);
                      };
                      // dimensions aren't available yet at ready() with
                      // preload:'metadata' — wait for the event that promises them
                      player.one('loadedmetadata', measure);
                      measure(); // covers a cached/instant-metadata video
                    }
                  : () => {}
              }
              fit={fit}
            />
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
            onLoad={
              adaptsToImage
                ? (e) => {
                    const { naturalWidth, naturalHeight } = e.currentTarget;
                    if (naturalWidth && naturalHeight) setNaturalRatio(naturalWidth / naturalHeight);
                  }
                : undefined
            }
            // width/height:100% alone silently no-ops here: this <img> sits
            // inside BaseMedia's own unstyled wrapper div AND react-medium-
            // image-zoom's own wrapper (ships with no explicit height in its
            // stylesheet), so the percentage-height chain breaks before it
            // ever reaches the real, aspect-ratio-driven height further up
            // (e.g. .games-modal__main-img-container). The <img> was
            // rendering at its own natural intrinsic size instead — e.g. a
            // short/wide artwork inside a taller aspect-ratio box left a
            // large empty gap below it, before the next element. position:
            // absolute + inset:0 skips both unstyled wrappers and anchors
            // straight to the nearest POSITIONED ancestor, same fix already
            // relied on for next/image's layout='fill' (see PfpImage above).
            style={{
              overflow: 'hidden',
              position: 'absolute',
              inset: 0,
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
