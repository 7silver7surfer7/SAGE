import {
  PresetDrop,
  useCreatePresetDropsMutation,
  useGetPresetDropsQuery,
} from '@/store/dropsReducer';
import { useState } from 'react';
import { toast } from 'react-toastify';
import LoaderDots from '../LoaderDots';
import LoaderSpinner from '../LoaderSpinner';

export default function PresetDropsPanel() {
  const { data: presetDrops, isLoading, isError, refetch } = useGetPresetDropsQuery();
  const [createPresetDrops, { isLoading: isCreating }] = useCreatePresetDropsMutation();
  const [selectedDrops, setSelectedDrops] = useState<PresetDrop[]>([]);
  const [duration, setDuration] = useState<number>(24);

  const handleRetryButtonClick = () => {
    refetch();
  };

  const handleCheckboxChange = (drop: PresetDrop, isChecked: boolean) => {
    if (isChecked) {
      setSelectedDrops((selectedDrops) => [...selectedDrops, drop]);
    } else {
      const newArray = [...selectedDrops.filter((item) => item != drop)];
      setSelectedDrops(newArray);
    }
  };

  const handleDurationSelectChange = (e: React.FormEvent<HTMLSelectElement>) => {
    const val = (e.target as HTMLSelectElement).value;
    setDuration(Number(val));
  };

  const handleCreateDropsButtonClick = async () => {
    if (selectedDrops.length == 0) {
      alert('Select one or more drops!');
      return;
    }
    const data = await createPresetDrops({ presetDrops: selectedDrops, durationHours: duration });
    if ((data as any).data) {
      toast.success(`Created ${selectedDrops.length} new drop(s)!`);
    }
  };

  if (isLoading) {
    return <LoaderDots />;
  }

  if (isError) {
    return (
      <div style={{ marginTop: '50px' }}>
        <div style={{ textAlign: 'center', width: '300px' }}>
          Unable to load preset data from AWS S3.
          <button
            onClick={handleRetryButtonClick}
            className='dashboard__wipe-button'
            style={{ width: '200px', marginTop: '30px', marginBottom: '150px' }}
          >
            click to retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', flexFlow: 'wrap', marginTop: '30px' }}>
        {presetDrops.map((drop: PresetDrop, i: number) => {
          return (
            <div key={i} style={{ textAlign: 'center', padding: '10px' }}>
              <label>
                <img src={drop.bannerS3Path} width={300} />
                <br />
                <input
                  type='checkbox'
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleCheckboxChange(drop, e.target.checked)
                  }
                />{' '}
                {drop.dropName} by {drop.artist.username || 'anon'} ({drop.nfts.length} NFTs)
              </label>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: '25px',
          marginLeft: 'auto',
          marginRight: 'auto',
          width: '400px',
          textAlign: 'center',
        }}
      >
        Drop duration:{' '}
        <select value={duration} onChange={handleDurationSelectChange}>
          <option value='0.25'>15 minutes</option>
          <option value='1'>1 hour</option>
          <option value='24'>24 hours</option>
          <option value='48'>48 hours</option>
          <option value='168'>1 week</option>
          <option value='336'>2 weeks</option>
          <option value='672'>4 weeks</option>
        </select>
        <br />
        <br />
        <button
          disabled={isCreating || selectedDrops.length == 0}
          className='games-modal__place-bid-button'
          onClick={handleCreateDropsButtonClick}
        >
          {isCreating ? (
            <LoaderSpinner />
          ) : selectedDrops.length == 0 ? (
            'select one or more drops'
          ) : (
            `create ${selectedDrops.length} selected drop${selectedDrops.length > 1 ? 's' : ''}`
          )}
        </button>
      </div>
    </>
  );
}
