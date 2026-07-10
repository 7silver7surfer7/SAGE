import { Dialog } from '@headlessui/react';

export interface Props {
  isOpen: boolean;
  closeModal: () => void;
  children?: JSX.Element;
  title?: string;
}

function index({ closeModal, children, isOpen, title }: Props) {
  return (
    <Dialog open={isOpen} onClose={closeModal} as='div' className='modal'>
      {/* The backdrop, rendered as a fixed sibling to the panel container */}
      <div className='modal__backdrop' aria-hidden='true' />
      {/* {container: covers entire screen, is always transparent, centers panel} */}
      <div className='modal__container'>
        <Dialog.Panel className='modal__panel' as='div'>
          <div className='modal__header'>
            <Dialog.Title as='h1'>{title}</Dialog.Title>
            <img
              className='modal__close__button'
              src='/interactive/close.svg'
              onClick={closeModal}
            />
          </div>
          {children}
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}

export default index;
