import Logotype from '@/components/Logotype';
import BigLogotype from '@/public/branding/big-logo-vertical.svg';

export default function submissions() {
  return (
    <div className='submissions-page'>
      <div className='submissions-page__logotype-container'>
        <Logotype></Logotype>
      </div>
      <h1 className='submissions-page__header'>
        Artist <br /> Submission
      </h1>
      <section className='submissions-page__main'>
        <div className='submissions-page__main-left'>
          <div className='submissions-page__guidelines-group'>
            <h1 className='submissions-page__guidelines-header'>Apply to SAGE</h1>
            <p className='submissions-page__guidelines-text'>
              SAGE looks to unite artists and collectors together. We have designed our market to
              emphasize curation but have added the ability to work outside this boundary. We
              believe in balance and openness for those accepted onto the platform. We have created
              this by balancing drops and profiles on SAGE. This empowers you to release a drop on
              your own, without needing to coordinate again with us. Meanwhile, SAGE collectors will
              browse the creator catalog to find your work. This creates a perfect balance between
              (a) curation from our part and (b) the balance to support all of the top artists. In
              balancing curation and a selection of artists, we ensure a scarcity of art on SAGE.
            </p>
          </div>
          <div className='submissions-page__guidelines-group'>
            <p className='submissions-page__guidelines-header'>NFT Standards</p>
            <p className='submissions-page__guidelines-text'>
              We provide specific guidelines regarding technical standards and image resolution
              minted SAGE artworks once accepted on the platform. Artists must meet these
              requirements. We do this to ensure that the quality of the work is up to par but also
              to make certain that the work will meet our expectations of how the featured art will
              look—and be presented—in an exhibition outside the web.
            </p>
          </div>
          <div className='submissions-page__aspect-ratios-section'>
            <div className='submissions-page__aspect-ratios-group'>
              <div className='submissions-page__aspect-ratios-example'>
                <div className='submissions-page__aspect-ratios-1-1'></div>
              </div>
              <p className='submissions-page__aspect-ratios-label'>1:1 artworks</p>
            </div>
            <div className='submissions-page__aspect-ratios-group'>
              <div className='submissions-page__aspect-ratios-example'>
                <div className='submissions-page__aspect-ratios-16-9'></div>
              </div>
              <p className='submissions-page__aspect-ratios-label'>16:9 artworks</p>
            </div>

            <div className='submissions-page__aspect-ratios-group'>
              <div className='submissions-page__aspect-ratios-example'>
                <div className='submissions-page__aspect-ratios-9-16'></div>
              </div>
              <p className='submissions-page__aspect-ratios-label'>9:16 artworks</p>
            </div>
          </div>
          <div className='submissions-page__guidelines-group'>
            <p className='submissions-page__guidelines-header'>How to Submit Your Application</p>
            <p className='submissions-page__guidelines-text'>
              To submit your application, we require a few things:
            </p>
            <ul className='submissions-page__guidelines-list'>
              <li>A brief description about yourself and your artist career.</li>
              <li>An artist portfolio.</li>
              <li>Links to your social media pages.</li>
            </ul>
            <p className='submissions-page__guidelines-text'>
              Artists can DM me on X.com{' '}
              <a href='https://x.com/sageartxyz' target='_blank' rel='noopener noreferrer'>
                @sageartxyz
              </a>
            </p>
          </div>
        </div>
        <div className='submissions-page__main-right'>
          <BigLogotype className='submissions-page__big-logo'></BigLogotype>
        </div>
      </section>
    </div>
  );
}
