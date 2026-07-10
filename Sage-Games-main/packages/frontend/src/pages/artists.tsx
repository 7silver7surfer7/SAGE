import useDropDown from '@/hooks/useDropDown';

export default function artists() {
  const { currentOption } = useDropDown(['Most Recent']);
  return (
    <div className='grid-page'>
      <section id='one'>
        <h1 id='header'>Artists</h1>
        <div id='filter'>
          <span>{currentOption}</span>
          <img src='/arrow-down.svg' alt='' />
        </div>
      </section>
      <section id='grid'></section>
    </div>
  );
}
