import { useRouter } from 'next/router';
import Link from 'next/link';
import Image from 'next/image';
import Connect from '@/components/Connect';
import { useSession } from 'next-auth/react';
interface NavLink {
  name: string;
  url: string;
}

const navLinks: NavLink[] = [
  {
    name: 'Home',
    url: '/',
  },
  // {
  //   name: 'Drops',
  //   url: '/drops',
  // },
  // { name: 'Artists', url: '/artists' },
  {
    name: 'About',
    url: '/about',
  },
];

function Rewards() {
  const { status } = useSession();

  if (!(status === 'authenticated')) return null;
  return (
    <Link href='/rewards'>
      <div className='rewards'>
        <h1>Rewards</h1>
      </div>
    </Link>
  );
}
export default function Nav() {
  const router = useRouter();
  return (
    <div className='nav'>
      <ul>
        {
          // <div className='logo'>
          //   <Image src='/' layout='fill' />
          // </div>
        }
        {navLinks.map((n: NavLink) => {
          return (
            <Link key={n.name} href={n.url}>
              <h1 className={`nav-links ${router.pathname == n.url ? 'active' : ''}`}>{n.name}</h1>
            </Link>
          );
        })}
      </ul>
      <Rewards />
      <div className='right'>
        <Connect />
      </div>
    </div>
  );
}
