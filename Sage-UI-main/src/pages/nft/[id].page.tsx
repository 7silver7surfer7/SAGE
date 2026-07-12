import prisma from '@/prisma/client';
import { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { BaseMedia } from '@/components/Media/BaseMedia';
import SageFullLogo from '@/public/branding/sage-full-logo.svg';
import CloseSVG from '@/public/interactive/close.svg';

interface Props {
  name: string;
  artist: string;
  src: string;
}

/**
 * Minimal NFT detail page — the games-modal (drop mint) template stripped to
 * a centered artwork with name + artist: no mint controls, no countdowns.
 * Search results link here (a minted piece has no game to open a modal for).
 */
export default function NftPage({ name, artist, src }: Props) {
  const router = useRouter();
  return (
    <div className='games-modal' style={{ minHeight: '100vh' }}>
      <section className='games-modal__header'>
        <SageFullLogo className='games-modal__sage-logo' />
        <button className='games-modal__close-button' onClick={() => router.back()}>
          <CloseSVG className='games-modal__close-button-svg' />
        </button>
      </section>
      <section className='games-modal__body'>
        {/* the modal's left-media/right-controls layout collapses to a single
            centered column here: artwork, then name + artist beneath it */}
        <div
          className='games-modal__main'
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '24px',
          }}
        >
          {/* BaseMedia is layout='fill' — it needs a positioned, explicitly
              sized ancestor. Cap to ~60vh so artwork + caption share the fold;
              fit='contain' shows the whole piece at its true aspect ratio. */}
          <div
            className='games-modal__main-img-container'
            style={{ position: 'relative', width: 'min(85vw, 900px)', height: '60vh' }}
          >
            <BaseMedia src={src} fit='contain' />
          </div>
          <div className='games-modal__main-content' style={{ textAlign: 'center' }}>
            <span className='games-modal__drop-name'>{name}</span>
            <p className='games-modal__game-name'>by {artist}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ params }) => {
  const id = Number(params?.id);
  if (!Number.isInteger(id)) return { notFound: true };
  const nft = await prisma.nft.findUnique({
    where: { id },
    include: { NftContract: { include: { Artist: true } } },
  });
  if (!nft || nft.isHidden) return { notFound: true };
  return {
    props: {
      name: nft.name,
      // same resolution order as search: drop pseudonym > username > wallet
      artist:
        nft.artistDisplayName ||
        nft.NftContract?.Artist?.username ||
        nft.artistAddress ||
        '',
      src: nft.s3PathOptimized,
    },
  };
};
