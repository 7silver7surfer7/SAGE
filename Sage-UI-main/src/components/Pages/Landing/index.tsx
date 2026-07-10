import LaunchTrailer from '@/components/LaunchTrailer';
import Motto from '@/components/Layout/Motto';
import Logotype from '@/components/Logotype';
export default function LandingPage() {
  return (
    <div className='landing-page'>
      <Motto></Motto>
      <Logotype></Logotype>
      {/* <LaunchTrailer></LaunchTrailer> */}
      {/* <div className='landing-page__content'>
        <div className='landing-page__sage-logo'>
          <SageFullLogoSVG className='landing-page__sage-svg' />
        </div>
        <div>
          <h1 className='landing-page__title'>
            SAGE is a curation system created to refine and lead Web3. <pre /> Through our portal,
            you secure an entrance into the future.
            <a href='mailto: contact@sage.art' className='landing-page__contact-label'>
              contact@sage.art
            </a>
          </h1>
        </div>
      </div> */}
    </div>
  );
}
