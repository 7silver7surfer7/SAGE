import { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { BadgeCheckIcon, CloudUploadIcon, CubeIcon, ExclamationCircleIcon, TicketIcon } from '@heroicons/react/outline';
import { ProgressBar } from '../ProgressBar';
import { validate } from './_validation';
import { handleDropUpload } from '../../services/dropUploadClient';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { format as formatDate } from 'date-fns';
import MediaPreview from '../MediaPreview';
import { Card } from 'react-bootstrap';

type Props = {
  formData: any;
  setFormData: (formData: any) => void;
};

export const Tab5_Review = ({ formData, setFormData }: Props) => {
  const [currentProgressPercent, setCurrentProgressPercent] = useState<number>(0);
  const [displayConfetti, setDisplayConfetti] = useState<boolean>(false);
  const [recycleConfetti, setRecycleConfetti] = useState<boolean>(true);
  const { width, height } = useWindowSize();

  const errors = validate(formData);

  const displayProgressBar = () => {
    document.getElementById('progressBar').style.display = 'block';
  };

  const onAuctionDragEnd = (result: any) => {
    if (!result.destination) {
      return;
    }
    const reordered = reorder(formData.auctionGames, result.source.index, result.destination.index);
    setFormData({ ...formData, auctionGames: reordered });
  };

  const onDrawingDragEnd = (result: any) => {
    if (!result.destination) {
      return;
    }
    const reordered = reorder(formData.drawingGames, result.source.index, result.destination.index);
    setFormData({ ...formData, drawingGames: reordered });
  };

  const startUpload = async (e: React.MouseEvent<HTMLButtonElement>) => {
    (e.target as HTMLButtonElement).disabled = true;
    try {
      const data = formData;
      // data.royaltySplitEntries = splitsAsArray(data, "rltySplit", "rltySplitAddr", [1, 2, 3, 4]);
      // data.primarySalesSplitEntries = splitsAsArray(
      //         data,
      //         "pmySalesSplit",
      //         "pmySalesSplitAddr",
      //         [1, 2, 3, 4]
      //     );
      setDisplayConfetti(false);
      setRecycleConfetti(true);
      displayProgressBar();
      await handleDropUpload(data, setCurrentProgressPercent);
      setDisplayConfetti(true);
      setTimeout(() => setRecycleConfetti(false), 5000);
    } catch (e) {
      console.log(e);
    }
    (e.target as HTMLButtonElement).disabled = false;
  };

  return (
    <div className='mt-5'>
      
      {displayConfetti && <Confetti width={width} height={height} recycle={recycleConfetti} />}
      
      {errors.map((item: string, i: number) => {
        return (
          <div key={i} className='mx-auto alert alert-danger' role='alert' style={{ width: '50%' }}>
            <ExclamationCircleIcon width='20' stroke='#842029' /> &nbsp; {item}
          </div>
        );
      })}

      {errors.length == 0 && (
        <>
          <div className='text-center'>
            <div className='mx-auto mt-3 alert alert-secondary' role='alert' style={{ width: '50%' }}>
              <CubeIcon width='20' /> &nbsp; <strong>{formData.name}</strong>
              <br />
              <br />
              {formData.description}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', alignItems: 'flex-start' }}>

            <ImagePreviewCard label={'Banner Image'} file={formData.bannerImageFile} />

            <ImagePreviewCard label={'Tile Image'} file={formData.tileImageFile} />

            <ImagePreviewCard label={'Featured Drop Media'} file={formData.featuredMediaFile} />

            <ImagePreviewCard label={'Mobile Cover Media'} file={formData.mobileCoverFile} />

          </div>
          <div className='text-center'>
            <div className='flex items-center'>

              <DragDropContext onDragEnd={onAuctionDragEnd}>
                <Droppable droppableId='droppable1'>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      style={getListStyle(snapshot.isDraggingOver)}
                    >
                      {formData.auctionGames.map((auction: any, i: number) => (
                        <Draggable key={i} draggableId={i.toString()} index={i}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              style={getItemStyle(snapshot.isDragging, provided.draggableProps.style)}
                            >
                              <GameReviewItem game={auction} nft={auction} gameType='auction' />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>

              <DragDropContext onDragEnd={onDrawingDragEnd}>
                <Droppable droppableId='droppable2'>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      style={getListStyle(snapshot.isDraggingOver)}
                    >
                      {formData.drawingGames.map((drawing: any, i: number) =>
                        drawing.nfts.map((nft: any, j: number) => (
                          <Draggable key={`${i}_${j}`} draggableId={`${i}_${j}`} index={i}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                style={getItemStyle(snapshot.isDragging, provided.draggableProps.style)}
                              >
                                <GameReviewItem game={drawing} nft={nft} gameType='drawing' />
                              </div>
                            )}
                          </Draggable>
                        ))
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>

            </div>

            <div id='allGoodNotification' className='mx-auto alert alert-primary mt-3' role='alert' style={{ width: '50%' }}>
              <BadgeCheckIcon width='20' stroke='#084298' /> &nbsp; Everything looks good!
            </div>

            <button id='uploadButton' className='mx-auto btn btn-primary mt-4' onClick={startUpload}>
              <CloudUploadIcon width='20' stroke='white' /> &nbsp; Upload Drop to {formData.target}
            </button>

            <div id='progressBar' className='mt-5 mx-auto' style={{ width: '50%', display: 'none' }}>
              <ProgressBar currentProgressPercent={currentProgressPercent} />
            </div>
            <div id='bottomSpacer' className='mb-5'></div>

          </div>
        </>
      )}
      <br />
      <br />
      {/* <div className='mx-auto' role='alert' style={{ width: '50%' }}>
        <pre>{JSON.stringify(formData, null, 2)}</pre>
      </div> */}
    </div>
  );
};

// Input file preview component ---------------------------------------------------------------------------------------

function ImagePreviewCard({ label, file }) {
  if (!file) {
    return null;
  }
  return (
    <Card style={{ width: '15rem' }}>
      <Card.Header>{label}</Card.Header>
      <Card.Body style={{ textAlign: 'center' }}>
        <MediaPreview file={file} previewWidth={200} />
      </Card.Body>
    </Card>
  );
}

// Game item preview component ----------------------------------------------------------------------------------------

function GameReviewItem({ game, gameType, nft }) {
  return (
    <table style={{ marginLeft: 'auto', marginRight: 'auto', width: '40%' }} cellPadding={'5px'}>
      <tbody>
        <tr>
          <td width='150'>
            <div style={{ marginRight: '25px' }}>{nft.previewJSX}</div>
          </td>
          <td style={{ textAlign: 'left', verticalAlign: 'middle', borderLeft: '1px solid gray' }}>
            <div style={{ marginLeft: '25px' }}>
              <div style={{ marginBottom: '5px' }}>
                {gameType == 'auction' ? <img src='/icon_auction_outline.svg' width={20} /> : <TicketIcon width='20' />}
              </div>
              <b>{nft.name}</b>{' '}
              <span style={{ fontSize: '12px' }}>
                | {nft.numberOfEditions || 1} edition(s)
                <br />
                start date: {formatDate(game.startDate * 1000, 'MM/dd/yyyy hh:mm aa')}
                <br />
                {game.endDate && `end date: ${formatDate(game.endDate * 1000, 'MM/dd/yyyy hh:mm aa')}`}
                {game.duration && `duration: ${game.duration / (60 * 60)} hours`}
                <br />
                description: {nft.description}
                <br />
                {gameType == 'auction' ? (
                  <>min price: {game.minPrice} ASH</>
                ) : (
                  <>
                    entry cost: {game.ticketCostTokens || 0} ASH + {game.ticketCostPoints || 0} PIXEL <br />
                    max tickets: {game.maxTickets || 0} total, {game.maxTicketsPerUser || 0} per user
                    <br />
                  </>
                )}
              </span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// Dragging helper functions ------------------------------------------------------------------------------------------

const reorder = (list: any[], startIndex: number, endIndex: number) => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
};

const getItemStyle = (isDragging: boolean, draggableStyle: any) => ({
  userSelect: 'none',
  padding: 10,
  background: isDragging ? '#eee' : '',
  borderRadius: isDragging ? '4px' : '',
  ...draggableStyle,
});

const getListStyle = (isDraggingOver: boolean) => ({
  border: isDraggingOver ? '1px dashed' : '',
  borderRadius: isDraggingOver ? '4px' : '',
});

// Splitter helper functions ------------------------------------------------------------------------------------------

const splitsAsArray = (data: any, pctField: string, adrField: string, range: number[]): any[] => {
  let splits = Array();
  for (let i of range) {
    let percent = data[`${pctField}${i}`];
    let destinationAddress = data[`${adrField}${i}`];
    if (percent && Number(percent) > 0 && destinationAddress && destinationAddress.length > 0) {
      splits.push({ percent: parseFloat(percent), destinationAddress });
    }
  }
  return splits;
};
