import { Dialog } from '@headlessui/react';
import { animated, useTransition } from 'react-spring';

export interface Props {
  isOpen: boolean;
  closeModal: () => void;
  children?: React.ReactNode;
  title?: string;
}

function index({ closeModal, children, isOpen, title }: Props) {
  const transition = useTransition(isOpen, {
    from: { translateY: 100 },
    enter: { translateY: 0 },
  });
  return transition((props) => (
    <Dialog open={isOpen} onClose={closeModal} as='div' className='modal'>
      <div className='modal__backdrop' aria-hidden='true' />
      <animated.div style={props} className='modal__container'>
        <Dialog.Panel className='modal__panel' as='div'>
          {children}
        </Dialog.Panel>
      </animated.div>
    </Dialog>
  ));
}

export default index;
