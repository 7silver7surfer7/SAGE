import { useRouter } from 'next/router';
import { Drop } from '@prisma/client';
import { basePathDrops } from '@/constants/paths';

interface Props {
  drop: Drop;
}

export default function GameInfo({ drop }: Props) {
  const router = useRouter();

  return (
    <div className='game__info'>
      <div className='game__info-nav'>
        <div className='game__info-nav-item game__info-nav-item--active'>About the Drop</div>
      </div>
      <div className='game__info-content'>
        <div className='game__info-about'>
          <h1 className='game__info-about-drop-title'>{drop.name}</h1>
          <p className='game__info-about-drop-description'>{drop.description}</p>
          <h1
            className='game__info-about-drop-link'
            onClick={() => router.push(`${basePathDrops}/${drop.id}`)}
          >
            See the full drop
          </h1>
        </div>
      </div>
    </div>
  );
}
