import { User } from '@/prisma/types';
import { PfpImage } from './Media/BaseMedia';

interface Props {
  artist: User;
}

function ArtistDisplay(props: Props) {
  if (!props.artist) return null;
  return (
    <div className='artist-display'>
      {/* no uploaded icon -> no icon at all (never the default SAGE mark) */}
      {props.artist?.profilePicture && (
        <div className='artist-display__pfp-container'>
          <PfpImage src={props.artist.profilePicture}></PfpImage>
        </div>
      )}
      <p className='artist-display__username'>{props.artist.username}</p>
    </div>
  );
}

export default ArtistDisplay;
