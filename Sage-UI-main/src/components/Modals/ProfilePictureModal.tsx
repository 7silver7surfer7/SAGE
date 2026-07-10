import React, { useState } from 'react';
import CloseSVG from '@/public/interactive/close.svg';
import Dropzone from 'react-dropzone';
import AvatarEditor from 'react-avatar-editor';
import type { SafeUserUpdate } from '@/prisma/types';
import { useGetUserQuery, useUpdateUserMutation } from '@/store/usersReducer';
import { DEFAULT_PROFILE_PICTURE } from '@/constants/config';
import Modal, { Props as ModalProps } from '@/components/Modals';

interface State {
  image: string;
  scale: number;
}

export default function ProfilePictureModal({ isOpen, closeModal }: ModalProps) {
  const initialState = {
    image: DEFAULT_PROFILE_PICTURE,
    scale: 1,
  };
  const [state, setState] = useState<State>(initialState);
  const { data: user } = useGetUserQuery();
  if (user && user.profilePicture) {
    initialState.image = user.profilePicture;
  }
  const [updateUser] = useUpdateUserMutation();

  var editor: any;

  const setEditorRef = (_editor: any) => {
    if (_editor) {
      editor = _editor;
    }
  };

  const handleDrop = (dropped: any) => {
    setState({ ...state, image: dropped[0] });
  };

  const handleNewImage = (e: any) => {
    setState({ ...state, image: e.target.files[0] });
  };

  const handleScale = (e: any) => {
    const _scale = parseFloat(e.target.value);
    setState({ ...state, scale: _scale });
  };

  const handleUploadBtnClick = () => {
    document.getElementById('newImage')?.click();
  };

  const save = () => {
    const newUser = {} as SafeUserUpdate;
    Object.assign(newUser, user);
    newUser.profilePicture = editor.getImageScaledToCanvas().toDataURL();
    updateUser(newUser);
    closeModal();
  };

  return (
    <Modal isOpen={isOpen} closeModal={closeModal}>
      <div className='profile-picture-modal'>
        <button className='games-modal__close-button'>
          <CloseSVG onClick={closeModal} className='games-modal__close-button-svg' />
        </button>
        <div>
          <Dropzone onDrop={handleDrop} noClick multiple={false} noKeyboard>
            {({ getRootProps }) => (
              <div {...getRootProps()}>
                <AvatarEditor
                  ref={setEditorRef}
                  scale={state.scale}
                  image={state.image}
                  // width={150}
                  // height={150}
                  // borderRadius={150}
                  color={[0, 0, 0, 0]}
                  style={{ borderRadius: '100%', width: '150px', height: '150px' }}
                />
              </div>
            )}
          </Dropzone>
          <input
            type='range'
            name='scale'
            onChange={handleScale}
            min='0.5'
            max='2'
            step='0.01'
            defaultValue='1'
          />
        </div>
        <div className='profile-picture-modal__btn-container'>
          <input
            id='newImage'
            name='newImage'
            type='file'
            onChange={handleNewImage}
            style={{ display: 'none' }}
          />
          <button
            type='button'
            className='profile-picture-modal__btn'
            onClick={handleUploadBtnClick}
          >
            upload file
          </button>
          <button
            type='button'
            data-type='save'
            className='profile-picture-modal__btn'
            onClick={save}
          >
            save
          </button>
        </div>
      </div>
    </Modal>
  );
}
