import TermsOfService from '@/components/Documents/TermsOfService';
import Logotype from '@/components/Logotype';
import BigLogotype from '@/public/branding/big-logo-vertical.svg';

export default function termsofservice() {
  return (
    <div className='submissions-page'>
      <div className='submissions-page__logotype-container'>
        <Logotype></Logotype>
      </div>
      {/* <h1 className='submissions-page__header'>
        Privacy <br /> Policy
      </h1> */}
      <section className='submissions-page__main'>
        <div className='submissions-page__main-left'>
          <TermsOfService />
        </div>
      </section>
    </div>
  );
}
