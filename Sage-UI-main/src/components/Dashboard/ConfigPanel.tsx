import {
  DEFAULT_PLATFORM_ROYALTY_ADDRESS,
  useGetConfigQuery,
  useGetPlatformRoyaltyAddressQuery,
  useSetPlatformRoyaltyAddressMutation,
  useUpdateConfigMutation,
} from '@/store/dashboardReducer';
import { useDeleteDropsMutation, useGetApprovedDropsQuery } from '@/store/dropsReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import { ethers } from 'ethers';
import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import LoaderDots from '../LoaderDots';
import LoaderSpinner from '../LoaderSpinner';

export function ConfigPanel() {
  const { data: drops, isFetching: isFetchingDrops } = useGetApprovedDropsQuery();
  const { data: config, isFetching: isFetchingConfig } = useGetConfigQuery();
  const [updateConfig, { isLoading: isUpdatingConfig }] = useUpdateConfigMutation();
  const [deleteDrops, { isLoading: isWiping }] = useDeleteDropsMutation();
  const [featuredDropId, setFeaturedDropId] = useState<number>(0);
  const [welcomeMessage, setWelcomeMessage] = useState<string>('');
  // on-chain platform royalty receiver (SageStorage address.royalty key)
  const { data: platformRoyaltyAddress } = useGetPlatformRoyaltyAddressQuery();
  const [setPlatformRoyaltyAddress, { isLoading: isSavingRoyaltyAddress }] =
    useSetPlatformRoyaltyAddressMutation();
  const { signer } = useSAGEAccount();
  const [royaltyAddressInput, setRoyaltyAddressInput] = useState<string>('');

  useEffect(() => {
    if (config) {
      setFeaturedDropId(config.featuredDropId);
      setWelcomeMessage(config.welcomeMessage);
    }
  }, [config]);

  useEffect(() => {
    if (platformRoyaltyAddress && platformRoyaltyAddress !== ethers.constants.AddressZero) {
      setRoyaltyAddressInput(platformRoyaltyAddress);
    }
  }, [platformRoyaltyAddress]);

  const handleRoyaltyAddressSave = async () => {
    // blank falls back to the platform default
    const target = royaltyAddressInput.trim() || DEFAULT_PLATFORM_ROYALTY_ADDRESS;
    if (!ethers.utils.isAddress(target)) {
      toast.warn('That does not look like a valid wallet address.');
      return;
    }
    if (!signer) {
      toast.warn('Connect the admin wallet first.');
      return;
    }
    if (target.toLowerCase() === (platformRoyaltyAddress || '').toLowerCase()) {
      toast.info('Platform royalty address is already set to that value.');
      return;
    }
    await setPlatformRoyaltyAddress({ address: target, signer: signer as any });
  };

  const handleFeaturedDropChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFeaturedDropId(Number(e.target.value));
  };

  const handleWelcomeMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setWelcomeMessage(e.target.value);
  };

  const handleSaveButtonClick = async () => {
    await updateConfig({ featuredDropId, welcomeMessage });
    toast.success('Changes successfully saved')
  };

  const handleWipeButtonClick = async () => {
    const text = prompt('Write WIPE to confirm permanently deleting all drops & NFT data');
    if (text && text.toUpperCase() == 'WIPE') {
      await deleteDrops();
      toast.success('Drops & NFTs permanently deleted')
    }
  };
  
  if (isFetchingConfig || isFetchingDrops) {
    return <LoaderDots />;
  }

  return (
    <div style={{ width: '30%', marginLeft: 'auto', marginRight: 'auto' }}>
      <div className='creations-panel__file-desc-group' style={{ marginTop: '25px' }}>
        <h1 className='creations-panel__file-desc-label'>Featured Drop</h1>
        <select
          value={featuredDropId || ''}
          onChange={handleFeaturedDropChange}
          className='creations-panel__file-input-field'
        >
          <option value={0}> -- latest -- </option>
          {drops.map((drop, i) => {
            return (
              <option key={i} value={drop.id}>
                [{drop.id}] '{drop.name}' by {drop.NftContract.Artist.username}
              </option>
            );
          })}
        </select>
      </div>
      <div className='creations-panel__file-desc-group' style={{ marginTop: '25px' }}>
        <h1 className='creations-panel__file-desc-label'>Welcome Message</h1>
        <textarea
          value={welcomeMessage}
          onChange={handleWelcomeMessageChange}
          className='creations-panel__file-desc-field'
          maxLength={500}
        />
      </div>
      <div className='creations-panel__file-desc-group' style={{ marginTop: '25px' }}>
        <button
          disabled={isUpdatingConfig}
          className='dashboard__submit-button'
          type='button'
          onClick={handleSaveButtonClick}
        >
          {isUpdatingConfig ? <LoaderSpinner /> : `save changes`}
        </button>
      </div>
      <div className='creations-panel__file-desc-group' style={{ marginTop: '45px' }}>
        <h1 className='creations-panel__file-desc-label'>Platform Royalty Address (on-chain)</h1>
        <input
          type='text'
          value={royaltyAddressInput}
          onChange={(e) => setRoyaltyAddressInput(e.target.value)}
          placeholder={`${DEFAULT_PLATFORM_ROYALTY_ADDRESS} (default)`}
          className='creations-panel__file-input-field'
          spellCheck={false}
        />
        <em style={{ display: 'block', fontSize: '0.75em', opacity: 0.7, marginTop: '4px' }}>
          Receives the platform&apos;s share of secondary-sale royalties. Leave blank to use the
          default. Saving sends a transaction from the connected admin wallet. Artist royalties
          always go to the artist&apos;s own wallet.
        </em>
        <button
          disabled={isSavingRoyaltyAddress}
          className='dashboard__submit-button'
          type='button'
          style={{ marginTop: '10px' }}
          onClick={handleRoyaltyAddressSave}
        >
          {isSavingRoyaltyAddress ? <LoaderSpinner /> : `save royalty address (on-chain)`}
        </button>
      </div>
      <div className='creations-panel__file-desc-group' style={{ marginTop: '125px' }}>
        <button
          disabled={isWiping}
          className='dashboard__wipe-button'
          type='button'
          onClick={handleWipeButtonClick}
        >
          {isWiping ? <LoaderSpinner /> : `wipe drop data (!)`}
        </button>
      </div>
    </div>
  );
}
