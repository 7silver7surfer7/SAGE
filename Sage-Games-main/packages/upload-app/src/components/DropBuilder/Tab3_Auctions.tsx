import { Tab, TabList, TabPanel, Tabs } from 'react-tabs';
import { getDimensions } from '../../utilities/mediaDimensions';
import { AuctionGameEntry } from './AuctionGameEntry';
import { createNftEntry } from './DropBuilder';

type Props = {
  formData: any;
  setFormData: (formData: any) => void;
};

export function Tab3_Auctions({ formData, setFormData }: Props) {
  const handleAddGameClick = () => {
    document.getElementById('auctionInputFile').click();
  };

  const handleHiddenInputFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const newFile = e.target.files[0];
    const newGame = createNftEntry(newFile);
    const { width, height } = await getDimensions(newFile);
    newGame.width = width;
    newGame.height = height;
    if (formData.auctionGames.length > 0) {
      // pre-fill with previous game data
      for (const field of ['startDate', 'minPrice', 'description']) {
        newGame[field] = formData.auctionGames[formData.auctionGames.length - 1][field];
      }
    }
    setFormData((prevData: any) => ({
      ...prevData,
      auctionGames: [...formData.auctionGames, newGame],
    }));
  };

  const handleDeleteGameClick = (delIndex: number) => {
    setFormData((prevData: any) => ({
      ...prevData,
      auctionGames: formData.auctionGames.filter((_: any, index: number) => index != delIndex),
    }));
  };

  const handleFieldChange = (srcIndex: number, name: string, value: any) => {
    let updatedGameArray = formData.auctionGames.map((game: any, index: number) =>
      index == srcIndex ? { ...game, [name]: value } : game
    );
    setFormData((prevData: any) => ({ ...prevData, auctionGames: updatedGameArray }));
  };

  return (
    <div className='container-lg mt-5 px-5'>
      <input
        type='file'
        id='auctionInputFile'
        style={{ display: 'none' }}
        accept='image/png, image/gif, image/jpeg, video/mp4'
        multiple={false}
        onChange={handleHiddenInputFileChange}
      />
      <Tabs forceRenderTabPanel={true}>
        <TabList>
          {formData.auctionGames.map((_: any, i: number) => {
            return (
              <Tab key={i}>
                <img src='/icon_auction_outline.svg' width={20} className='mx-1' alt='' />
                Auction {i + 1}
              </Tab>
            );
          })}
          <Tab onClick={handleAddGameClick}>+ Add Auction Game</Tab>
        </TabList>
        {formData.auctionGames.map((auction: any, i: number) => {
          return (
            <TabPanel key={i}>
              <AuctionGameEntry
                index={i}
                data={auction}
                onDelete={handleDeleteGameClick}
                onFieldChange={handleFieldChange}
              />
            </TabPanel>
          );
        })}
        <TabPanel></TabPanel>
      </Tabs>
    </div>
  );
}
