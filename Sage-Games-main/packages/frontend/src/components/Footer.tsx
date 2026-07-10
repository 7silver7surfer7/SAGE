import Image from 'next/image';

const socials = ['discord', 'insta', 'medium', 'opensea', 'telegram', 'twitter'];

const tokens = ['cmc', 'uniswap'];

export default function Footer() {
  return (
    <div className='footer'>
      <div className='inner'>
        <div className='logo-and-social'>
          <div className='social-icons'>
            {socials.map((s, i: number) => (
              <div className='social-icon' key={i}>
                <Image src={`/socials/${s}.svg`} layout='fill' />
              </div>
            ))}
            <div className='rectangle' />
            {tokens.map((t, i: number) => (
              <div className='token-icon' key={i}>
                <Image src={`/tokens/${t}.svg`} layout='fill' />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className='links'>
        <ul className='column'>
          <li className='title'>contact SAGE</li>
          <li>Contact for artists</li>
          <li>Contact for new business</li>
          <li>Email us</li>
        </ul>
      </div>
    </div>
  );
}
