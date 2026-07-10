import { PfpImage } from '@/components/Media/BaseMedia';
import { User } from '@prisma/client';

interface Props {
  latestArtists: User[];
}
export default function LatestArtists({ latestArtists }: Props) {
  if (!latestArtists) return null;
  return (
    <section className='home-page__latest-artists-section'>
      <p className='home-page__latest-artists-header'>LATEST CREATORS</p>
      <p className='home-page__latest-artists-subheader'>
        A batch of artist that just joined and we think you should follow
      </p>
      <div className='home-page__latest-artists-flex-container'>
        {latestArtists.map((a) => {
          return (
            <div key={a.username} className='home-page__latest-artists-item'>
              <PfpImage src={a.profilePicture}></PfpImage>
            </div>
          );
        })}
      </div>
    </section>
  );
}
