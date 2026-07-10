import { useEffect, useRef } from 'react';
import videojs from 'video.js';

interface Props {
  options: any;
  onReady: (player: any) => void;
  className?: string;
}

export const VideoJS = ({ options, onReady, className }: Props) => {
  const videoRef = useRef(null);
  const playerRef = useRef(null);

  useEffect(() => {
    // Make sure Video.js player is only initialized once
    if (!playerRef.current) {
      const videoElement = videoRef.current;
      if (!videoElement) return;
      const player = (playerRef.current = videojs(videoElement, options, () => {
        videojs.log('player is ready');
        onReady && onReady(player);
      }));
      // You could update an existing player in the `else` block here
      // on prop change, for example:
    } else {
      // const player = playerRef.current;
      // player.autoplay(options.autoplay);
      // player.src(options.sources);
    }
  }, [options, videoRef]);

  // Dispose the Video.js player when the functional component unmounts
  useEffect(() => {
    const player = playerRef.current;
    return () => {
      if (player) {
        player.dispose();
        playerRef.current = null;
      }
    };
  }, [playerRef]);

  return (
    // Chromium/WebKit render <video> as solid black when an ancestor has a
    // 3D CSS transform (e.g. Swiper's coverflow rotateY on non-active
    // slides) — forcing this wrapper onto its own compositing layer works
    // around it. Applied here (not on the <video> itself) since video.js
    // takes over that element's DOM/attributes after mount.
    <div
      data-vjs-player
      className={className}
      style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
    >
      <video
        ref={videoRef}
        className={'video-js vjs-big-play-centered'}
        style={{
          inset: '0px',
          overflow: 'hidden',
          position: 'absolute',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </div>
  );
};

export default VideoJS;
