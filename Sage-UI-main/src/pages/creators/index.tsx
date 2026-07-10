import Logotype from '@/components/Logotype';
import ArtistsRow from '@/components/Pages/Artists/Row';
import prisma from '@/prisma/client';
import { getArtistsPageData } from '@/prisma/functions';

export interface Props {
  artistGroups: Awaited<ReturnType<typeof getArtistsPageData>>[];
}

export default function artists({ artistGroups }: Props) {
  return (
    <div className='artists-page'>
      <div className='artists-page__logotype'>
        <Logotype />
      </div>
      <div className='artists-page__header-content'></div>
      {artistGroups.map((artists, i: number) => {
        let shouldStartAsymmetric: boolean = false;
        if (i % 2 !== 0) {
          shouldStartAsymmetric = true;
        }
        return (
          <ArtistsRow
            key={i}
            shouldStartAsymmetric={shouldStartAsymmetric}
            artists={artists}
          ></ArtistsRow>
        );
      })}
    </div>
  );
}

export async function getStaticProps() {
  const artists = await getArtistsPageData(prisma);
  const midPoint: number = Math.floor(artists.length / 2);
  const groupOne = artists.slice(0, midPoint);
  const groupTwo = artists.slice(midPoint, artists.length);

  return {
    props: {
      artistGroups: [groupOne, groupTwo],
    },
    revalidate: 60,
  };
}
