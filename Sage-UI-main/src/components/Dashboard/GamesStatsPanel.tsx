import { Drop_include_GamesAndArtist } from '@/prisma/types';
import { useGetAuctionStateQuery } from '@/store/auctionsReducer';
import { useGetSalesEventsQuery } from '@/store/dashboardReducer';
import { useGetApprovedDropsQuery } from '@/store/dropsReducer';
import { Lottery } from '@/types/contracts';
import { getLotteryContract } from '@/utilities/contracts';
import shortenAddress from '@/utilities/shortenAddress';
import { formatDateYYMMddHHmm, formatTimestampYYMMddHHmm } from '@/utilities/strings';
import { SaleEvent, SaleEventType } from '@prisma/client';
import { useEffect, useState } from 'react';
import Countdown from '../Countdown';
import LoaderDots from '../LoaderDots';

const pollingInterval = 120000; // refetch dashboard data every two minutes

export function GamesStatsPanel() {
  const { data: drops, isLoading: isLoadingDrops } = useGetApprovedDropsQuery(undefined, {
    pollingInterval,
  });
  const { data: sales, isLoading: isLoadingSales } = useGetSalesEventsQuery(undefined, {
    pollingInterval,
  });

  if (isLoadingDrops || isLoadingSales) {
    return <LoaderDots />;
  }

  return (
    <>
      {drops?.map((drop: Drop_include_GamesAndArtist, i) => (
        <div key={i} className='dashboard-game-stats__container'>
          <div
            className='dashboard-game-stats__item nft-tile dashboard-game-stats__tile'
            style={{ textAlign: 'center', marginTop: '15px' }}
          >
            <img src={drop.bannerImageS3Path} width={180} style={{ marginBottom: '10px' }} />
            <span className='dashboard-game-stats__id dashboard-game-stats__tile'>{drop.name}</span>
            <br />
            <span className='dashboard-game-stats__id'>
              by {drop.NftContract.Artist.username || shortenAddress(drop.artistAddress)}
            </span>
          </div>
          <div className='dashboard-game-stats__item'>
            <table width='500'>
              <tbody>
                {drop.Lotteries.map((lottery, i) => {
                  const tickets = filterLotteryTickets(sales, lottery.id);
                  return (
                    <tr key={i} style={{ border: '1px solid gray', height: '95px' }}>
                      <td style={{ verticalAlign: 'middle' }}>
                        <span className='dashboard-game-stats__id'>{lottery.Nfts[0].name}</span>
                        <br />
                        {new Date(lottery.endTime).getTime() > new Date().getTime() ? (
                          <Countdown
                            className='status__countdown'
                            endTime={new Date(lottery.endTime).getTime()}
                          />
                        ) : (
                          <>
                            end date: {formatDateYYMMddHHmm(lottery.endTime)}
                            <br />
                          </>
                        )}
                        {lottery.Nfts[0].numberOfEditions} editions |{' '}
                        {lottery.costPerTicketTokens} SAGE +{' '}
                        {lottery.costPerTicketPoints || 0} PIXEL
                      </td>
                      <td style={{ verticalAlign: 'middle' }}>
                        entries: <span style={{ fontWeight: 'bold' }}><TicketCount id={lottery.id} /></span>
                        {tickets.length > 0 && (
                          <DownloadIcon callback={() => downloadTickets(sales, lottery.id)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className='dashboard-game-stats__item' style={{ minWidth: '400px' }}>
            <table width='500'>
              <tbody>
                {drop.Auctions.map((auction, i) => {
                  return (
                    <tr key={i} style={{ border: '1px solid gray', height: '95px' }}>
                      <td style={{ verticalAlign: 'middle' }}>
                        <span className='dashboard-game-stats__id'>{auction.Nft.name}</span>
                      </td>
                      <td style={{ verticalAlign: 'middle' }}>
                        <AuctionContractState id={auction.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

const filterLotteryTickets = (sales: SaleEvent[], id: number): SaleEvent[] => {
  const tickets = [];
  for (let e of sales) {
    if (e.eventType == SaleEventType.LOTTERY && e.eventId == id) {
      tickets.push(e);
    }
  }
  return tickets;
};

function download(filename: string, filecontents: string) {
  var element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(filecontents));
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

function downloadTickets(sales: SaleEvent[], lotteryId: number) {
  const lotteryIdHexStr = '0x' + lotteryId.toString(16);
  var filecontents = 'txnHash,wallet,amount';
  filterLotteryTickets(sales, lotteryId).forEach((ticket: SaleEvent) => {
    filecontents += `\n${ticket.txHash},${ticket.buyer},${ticket.amountTokens}`;
  });
  download(`lottery_${lotteryId}_tickets_${getDateYYYYMMDDhhmmss()}.txt`, filecontents);
}

function AuctionContractState({ id }) {
  const { data } = useGetAuctionStateQuery(id);
  if (data) {
    return (
      <>
        {data.highestBidNumber == 0 ? (
          'no bids yet'
        ) : (
          <>
            {data.endTime > new Date().getTime() ? (
              <Countdown className='status__countdown' endTime={data.endTime} />
            ) : (
              <>
                end date: {formatTimestampYYMMddHHmm(data.endTime / 1000)}
                <br />
              </>
            )}
            bid: {data.highestBidNumber.toLocaleString()} SAGE
            <br />
            by {shortenAddress(data.highestBidder)}
          </>
        )}
      </>
    );
  }
  return <></>;
}

function DownloadIcon({ callback }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          backgroundColor: '#161619',
          width: '10px',
          padding: '3px',
          borderRadius: '3px',
          marginTop: '5px',
          cursor: 'pointer',
        }}
      >
        <a onClick={callback}>
          <img src='/icons/download.svg' width={20} className='dashboard-white-icon' />
        </a>
      </div>
    </div>
  );
}

function TicketCount({ id }) {
  const [count, setCount] = useState<number>();  
  const loadAsyncData = async () => {
    const contract = await getLotteryContract();
    const info = await contract.getLotteryInfo(id);
    setCount(info.numberOfTicketsSold);
  };
  useEffect(() => {
    loadAsyncData();
  }, []);
  return <>{count ? count : ''}</>;
}

function getDateYYYYMMDDhhmmss(): string {
  var d = new Date();
  return (
    d.getFullYear() +
    ('0' + (d.getMonth() + 1)).slice(-2) +
    ('0' + d.getDate()).slice(-2) +
    ('0' + d.getHours()).slice(-2) +
    ('0' + d.getMinutes()).slice(-2) +
    ('0' + d.getSeconds()).slice(-2)
  );
}
