import { useGetConfigQuery, useUpdateConfigMutation } from '@/store/dashboardReducer';
import { useDeleteDropsMutation, useGetApprovedDropsQuery } from '@/store/dropsReducer';
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

  useEffect(() => {
    if (config) {
      setFeaturedDropId(config.featuredDropId);
      setWelcomeMessage(config.welcomeMessage);
    }
  }, [config]);

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
