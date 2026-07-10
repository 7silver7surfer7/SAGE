import Logotype from '@/components/Logotype';
import IconWhite from '@/public/press/icon-white.svg';
import IconBlack from '@/public/press/icon-black.svg';
import LogotypeWhite from '@/public/press/logotype-white.svg';
import LogotypeBlack from '@/public/press/logotype-black.svg';

export default function press() {
  function handleDownloadSVGFiles() {
    window.open('/press/logotype-white.svg');
  }
  return (
    <div className='press-page'>
      <Logotype></Logotype>
      <div className='press-page__content'>
        <h1 className='press-page__header'>
          official press <pre></pre> release resources
        </h1>
        <div className='press-page__assets-container'>
          <div className='press-page__icons-container'>
            <a className='press-page__icon-white'>
              <IconWhite />
            </a>
            <div className='press-page__icon-black'>
              <IconBlack />
            </div>
          </div>
          <div className='press-page__logotypes-container'>
            <div className='press-page__logotype-white'>
              <LogotypeWhite />
            </div>
            <div className='press-page__logotype-black'>
              <LogotypeBlack />
            </div>
          </div>
        </div>
        <h3 className='press-page__subheader'>sage logotype and icon</h3>
        <p className='press-page__subheader-info'>
          Use this logotypes for any press releases or articles that is about SAGE. Please note SAGE
          is trademarked logo and using this logotype is not permitted outside press releases
        </p>
        <p className='press-page__subheader-info'>Sketch 92 - SVG downloadable</p>
        <p className='press-page__subheader-info'>SVG Download</p>
        <div className='press-page__downloads-container'>
          <button className='press-page__download-button'>Download SKETCH Files</button>
          <button onClick={handleDownloadSVGFiles} className='press-page__download-button'>
            DOWNLOAD SVG Files
          </button>
        </div>
      </div>
    </div>
  );
}
