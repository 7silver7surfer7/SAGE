import { Tab, TabList, TabPanel, Tabs } from 'react-tabs';
import { TicketIcon } from '@heroicons/react/outline';
import { DrawingGameEntry } from './DrawingGameEntry';

type Props = {
  formData: any;
  setFormData: (formData: any) => void;
};

export const Tab4_Drawings = ({ ...props }: Props) => {
  const handleAddGameClick = () => {
    let newGame = { nfts: [] };
    if (props.formData.drawingGames.length > 0) {
      // pre-fill with previous game data
      for (const field of ['startDate', 'endDate', 'ticketCostTokens', 'ticketCostPoints', 'maxTickets', 'maxTicketsPerUser']) {
        newGame[field] = props.formData.drawingGames[props.formData.drawingGames.length - 1][field];
      }
    }
    props.setFormData((prevData: any) => ({ ...prevData, drawingGames: [...props.formData.drawingGames, newGame] }));
  };

  const handleDeleteGameClick = (delIndex: number) => {
    props.setFormData((prevData: any) => ({
      ...prevData,
      drawingGames: props.formData.drawingGames.filter((_: any, index: number) => index != delIndex),
    }));
  };

  const handleFieldChange = (srcIndex: number, name: string, value: any) => {
    let updatedGameArray = props.formData.drawingGames.map((game: any, index: number) =>
      index === srcIndex ? { ...game, [name]: value } : game
    );
    props.setFormData((prevData: any) => ({ ...prevData, drawingGames: updatedGameArray }));
  };

  return (
    <div className='container-lg mt-5 px-5'>
      <Tabs forceRenderTabPanel={true}>
        <TabList>
          {props.formData.drawingGames.map((_: any, i: number) => {
            return (
              <Tab key={i}>
                <TicketIcon width={20} className='mx-1' />
                Drawing {i + 1}
              </Tab>
            );
          })}
          <Tab>
            <a id='addDrawingGameTab' onClick={handleAddGameClick}>
              + Add Drawing Game
            </a>
          </Tab>
        </TabList>
        {props.formData.drawingGames.map((drawing: any, i: number) => {
          return (
            <TabPanel key={i}>
              <DrawingGameEntry
                index={i}
                data={drawing}
                formData={props.formData}
                setFormData={props.setFormData}
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
};
