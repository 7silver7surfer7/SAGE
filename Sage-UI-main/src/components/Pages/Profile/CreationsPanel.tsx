import React, { Fragment } from 'react';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { useSigner } from 'wagmi';
import { Signer } from 'ethers';
import LoaderSpinner from '@/components/LoaderSpinner';
import { MintRequest, useMintSingleNftMutation } from '@/store/nftsReducer';
import FileInputWithPreview from '@/components/FileInputWithPreview';
import {
  useDeployArtistNftContractMutation,
  useGetArtistNftContractAddressQuery,
} from '@/store/artistsReducer';
import { useSession } from 'next-auth/react';
import { User } from '@prisma/client';

interface State {
  file: File | null;
  width: number | null;
  height: number | null;
  s3Path: string | null;
  s3PathOptimized: string | null;
  title: string;
  description: string;
  //tags: string;
  price: string;
  isFixedPrice: boolean;
}

const INITIAL_STATE: State = {
  file: null,
  width: null,
  height: null,
  s3Path: null,
  s3PathOptimized: null,
  title: '',
  description: '',
  //tags: '',
  price: '',
  isFixedPrice: true,
};

export default function CreationsPanel({ user }: { user: User }) {
  const [state, setState] = useState<State>(INITIAL_STATE);
  const [mintSingleNft, { isLoading: isMinting }] = useMintSingleNftMutation();
  const [deployContract, { isLoading: isDeployingContract }] = useDeployArtistNftContractMutation();
  const { data: signer } = useSigner();
  const { data: sessionData } = useSession();
  const { data: artistNftContractAddress, isLoading: isLoadingContract } =
    useGetArtistNftContractAddressQuery(sessionData?.address as string, {
      skip: !sessionData,
    });

  function handleTitleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setState((prevState) => {
      return { ...prevState, title: e.target.value };
    });
  }

  function handlePriceInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setState((prevState) => {
      return { ...prevState, price: e.target.value };
    });
  }

  function handlePriceTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setState((prevState) => {
      return { ...prevState, isFixedPrice: 'true' == e.target.value };
    });
  }

  // function handleTagsInputChange(e: React.ChangeEvent<HTMLInputElement>) {
  //   setState((prevState) => {
  //     return { ...prevState, tags: e.target.value };
  //   });
  // }

  function handleDescriptionInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setState((prevState) => {
      return { ...prevState, description: e.target.value };
    });
  }

  function handleFileInputChange(file: File | null) {
    setState((prevState) => {
      return { ...prevState, file };
    });
  }

  function handleGeneratePreview(s3Path: string | null, s3PathOptimized: string | null) {
    setState((prevState) => {
      return { ...prevState, s3Path, s3PathOptimized };
    });
  }

  function handleAspectRatioChange(width: number, height: number) {
    setState((prevState) => {
      return { ...prevState, width, height };
    });
  }

  async function handleDeployContractButtonClick() {
    if (!signer) {
      toast.info('Please sign in with a wallet.');
      return;
    }
    if (!user.bio) {
      toast.info('Please input and save your bio before deploying the contract.');
      return;
    }
    if (!user.bannerImageS3Path) {
      toast.info('Please input and save your banner image before deploying the contract.');
      return;
    }
    await deployContract({
      artistAddress: sessionData?.address as string,
      signer: signer as Signer,
    });
  }

  async function handleMintButtonClick() {
    if (!signer) {
      toast.info('Please sign in with a wallet.');
      return;
    }
    if (!state.file) {
      toast.warn('Please select a valid file for uploading your artwork');
      return;
    }
    if (state.title.trim().length == 0) {
      toast.warn('Please type a title for your artwork');
      return;
    }
    const priceNum = parseFloat(state.price);
    if (isNaN(priceNum) || priceNum <= 0) {
      toast.warn('Please type a valid price for your artwork');
      return;
    }
    toast.info('Please sit back, this might take a minute or so!');
    const result = await mintSingleNft({
      name: state.title,
      description: state.description,
      //tags: state.tags,
      price: parseFloat(state.price),
      isFixedPrice: state.isFixedPrice,
      file: state.file,
      width: state.width,
      height: state.height,
      s3Path: state.s3Path,
      s3PathOptimized: state.s3PathOptimized,
      signer: signer as Signer,
    } as MintRequest);
    const nftId = parseInt((result as any).data);
    if (isNaN(nftId) || nftId == 0) {
      toast.error('Failure minting NFT');
    } else {
      toast.success(`Success! NFT minted!`);
    }
  }

  return (
    <Fragment>
      <div className='creations-panel'>
        <form className='creations-panel__form'>
          {/* <div className='creations-panel__aspect-ratio-selection'>
            <p className='creations-panel__aspect-ratio-selection-label'>CHOOSE A FORMAT</p>
            <fieldset id='aspect-ratio' className='creations-panel__aspect-ratio-selection-flex'>
              <div className='creations-panel__aspect-ratio-selection-item'>
                <input
                  type='radio'
                  name='aspect-ratio'
                  className='creations-panel__aspect-ratio-selection-item-ratio'
                  data-ratio='1x1'
                ></input>
                <div className='creations-panel__aspect-ratio-selection-item-icon--1x1'></div>
              </div>
              <div className='creations-panel__aspect-ratio-selection-item'>
                <input
                  name='aspect-ratio'
                  type='radio'
                  data-ratio='16x9'
                  className='creations-panel__aspect-ratio-selection-item-ratio'
                ></input>
                <div className='creations-panel__aspect-ratio-selection-item-icon--16x9'></div>
              </div>
              <div className='creations-panel__aspect-ratio-selection-item'>
                <input
                  type='radio'
                  name='aspect-ratio'
                  data-ratio='16x9'
                  className='creations-panel__aspect-ratio-selection-item-ratio'
                ></input>
                <div className='creations-panel__aspect-ratio-selection-item-icon--9x16'></div>
              </div>
            </fieldset>
          </div> */}
          {artistNftContractAddress ? (
            <span
              onClick={() => {
                window.navigator.clipboard.writeText(artistNftContractAddress);
                toast.success('Copied to clipboard!', { toastId: 'clipboard#contract' });
              }}
              data-active={!!artistNftContractAddress}
              className='creations-panel__contract-address'
            >
              Your SAGE NFT Contract: {artistNftContractAddress}
            </span>
          ) : (
            <button
              disabled={isLoadingContract || isDeployingContract || isMinting}
              className='creations-panel__submit-button'
              type='button'
              onClick={handleDeployContractButtonClick}
            >
              {isLoadingContract || isDeployingContract || isMinting ? (
                <LoaderSpinner />
              ) : (
                `deploy your SAGE NFT contract`
              )}
            </button>
          )}
          <div className='creations-panel__file-upload-group'>
            <FileInputWithPreview
              onFileChange={handleFileInputChange}
              onGeneratePreview={handleGeneratePreview}
              onAspectRatioChange={handleAspectRatioChange}
            />
            <h1 className='creations-panel__file-upload-label'>
              ADD AN ARTWORK ( WE SUPPORT JPG, PNG, GIF, TIFF, SVG and MP4 )
            </h1>
          </div>
          <div className='creations-panel__file-title-group'>
            <input
              value={state.title}
              onChange={handleTitleInputChange}
              className='creations-panel__file-title-field'
              placeholder='ADD AN ARTWOR TITLE'
            />
          </div>{' '}
          <div className='creations-panel__file-desc-group'>
            <textarea
              value={state.description}
              onChange={handleDescriptionInputChange}
              className='creations-panel__file-desc-field'
              maxLength={500}
              placeholder='ADD A DESCRIPTION OF YOUR WORK'
            />
          </div>
          {/* <div className='creations-panel__file-title-group'>
            <h1 className='creations-panel__file-title-label'>tags</h1>
            <input
              value={state.tags}
              onChange={handleTagsInputChange}
              className='creations-panel__file-title-field'
            />
          </div> */}
          <div className='creations-panel__file-title-group'>
            <h1 className='creations-panel__file-title-label'>pricing type *</h1>
            <select onChange={handlePriceTypeChange} className='creations-panel__file-title-field'>
              <option value='true'>fixed price</option>
              <option value='false'>minimum price</option>
            </select>
          </div>
          <div className='creations-panel__file-title-group'>
            <h1 className='creations-panel__file-title-label'>artwork price (SAGE) *</h1>
            <input
              type='number'
              value={state.price}
              onChange={handlePriceInputChange}
              className='creations-panel__file-title-field'
            />
          </div>
          <button
            disabled={isMinting || isDeployingContract || !artistNftContractAddress}
            className='creations-panel__submit-button'
            type='button'
            onClick={handleMintButtonClick}
          >
            {isMinting || isDeployingContract ? <LoaderSpinner /> : `mint artwork`}
          </button>
        </form>
      </div>
    </Fragment>
  );
}
