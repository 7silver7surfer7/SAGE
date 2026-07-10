import dynamic from 'next/dynamic';
const VideoJS = dynamic(() => import('@/components/Media/VideoJS'), { ssr: false });
import { useRef } from 'react';

export default function video() {
  //s3.us-east-2.amazonaws.com/sage.art/
  const playerRef = useRef(null);

  const videoJsOptions = {
    autoplay: true,
    controls: false,
    responsive: true,
    loop: true,
    sources: [
      {
        src: 'https://d180qjjsfkqvjc.cloudfront.net/trailers/lehel_new.m3u8',
        type: 'application/x-mpegURL',
      },
    ],
  };

  const handlePlayerReady = (player) => {
    playerRef.current = player;

    // You can handle player events here, for example:
    player.on('waiting', () => {
      console.log('player is waiting');
    });

    player.on('dispose', () => {
      console.log('player will dispose');
    });
    //player.play()
  };

  return (
    <div style={{ marginTop: '50px', marginRight: 'auto', marginLeft: 'auto' }}>
      <VideoJS options={videoJsOptions} onReady={handlePlayerReady} />
    </div>
  );
}
