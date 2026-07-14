import FooterLogoSVG from '@/public/branding/footer-logo.svg';
import Socials from '@/components/Socials';
import { SearchInput } from '../SearchInput';
import useSageRoutes from '@/hooks/useSageRoutes';
import Copyright from '../Branding/Copyright';
import Motto from './Motto';

export default function Footer() {
  const { pushToHowToBuyAsh, pushToPrivacyPolicy, pushToTermsOfService, pushToAgentApi } =
    useSageRoutes();

  return (
    <div className='footer' data-cy='footer'>
      <div className='footer__content'>
        <div className='footer__top'>
          <div className='footer__top-content'>
            <div className='footer__logo'>
              <FooterLogoSVG className='footer__logo-svg'></FooterLogoSVG>
            </div>
            <div className='footer__search-container'>
              <div className='searchform'>
                <SearchInput
                  placeholder='search sage'
                  displayIcon={true}
                  className='searchform__input'
                ></SearchInput>
              </div>
            </div>
          </div>
        </div>
        <div className='footer__middle'>
          <div className='footer__middle-info'>
            <ul className='footer__middle-item'>
              <div className='footer__middle-item-header'>contact sage</div>
              <div className='footer__middle-item-content'>
                <h1 className='footer__middle-item-content-link'>
                  <a href='https://x.com/sageartxyz' target='_blank' rel='noopener noreferrer'>
                    Business Inquiry
                  </a>
                </h1>
                <h1 className='footer__middle-item-content-link'>
                  <a href='https://x.com/sageartxyz' target='_blank' rel='noopener noreferrer'>
                    Support
                  </a>
                </h1>
              </div>
            </ul>
            <ul className='footer__middle-item'>
              <div className='footer__middle-item-header'>Resources</div>
              <div className='footer__middle-item-content'>
                <div className='footer__middle-item-content-link'>
                  <a onClick={pushToHowToBuyAsh}>Get SAGE & Earn Pixels</a>
                </div>

                <div className='footer__middle-item-content-link'>
                  <a onClick={pushToAgentApi}>Agent API (MCP)</a>
                </div>

                <div className='footer__middle-item-content-link'>
                  <a onClick={pushToPrivacyPolicy}>Privacy Policy</a>
                </div>

                <div className='footer__middle-item-content-link'>
                  <a onClick={pushToTermsOfService}>Terms of Service</a>
                </div>
              </div>
            </ul>
            <ul className='footer__middle-item'>
              <div className='footer__middle-item-header'>press</div>
              <div className='footer__middle-item-content'>
                <h1 className='footer__middle-item-content-link'>
                  <a href='/press'>SAGE Press</a>
                </h1>
              </div>
            </ul>
            <ul className='footer__middle-item footer__socials'>
              <div className='footer__middle-item-header'>follow us on</div>
              <div className='footer__middle-item-content'>
                <Socials></Socials>
              </div>
            </ul>
          </div>
          <ul className=' footer__socials-mobile'>
            <div className='footer__middle-item-header'>follow us on</div>
            <div className='footer__middle-item-content'>
              <Socials></Socials>
            </div>
          </ul>
        </div>
        <div className='footer__bottom'>
          <h4 className='footer__copyright'>
            <Copyright />
          </h4>
        </div>
      </div>
    </div>
  );
}
