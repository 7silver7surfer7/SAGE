import { Drop_include_GamesAndArtist } from '@/prisma/types';
import { useGetApprovedDropsQuery } from '@/store/dropsReducer';
import shortenAddress from '@/utilities/shortenAddress';
import { gql, useQuery } from '@apollo/client';
import { utils } from 'ethers';
import { toast } from 'react-toastify';
import Countdown from '../Countdown';
import LoaderDots from '../LoaderDots';

const GAMES_QUERY = gql`
  query GetGames {
    lotteries {
      id
      status
      tickets {
        id
        txnHash
        address
      }
      claimedPrizes {
        id
        txnHash
      }
    }
    auctions {
      id
      status
      highestBid
      highestBidder
      endTime
      bids {
        id
        txnHash
        bidder
        amount
        blockTimestamp
      }
    }
  }
`;

export function GamesStatsPanel() {
  const { data: drops, isFetching: isLoadingFromDB } = useGetApprovedDropsQuery();
  const { loading: isLoadingFromSubgraph, data: graphData, startPolling } = useQuery(GAMES_QUERY);
  startPolling(3000);

  function download(filename: string, filecontents: string) {
    var element = document.createElement('a');
    element.setAttribute(
      'href',
      'data:text/plain;charset=utf-8,' + encodeURIComponent(filecontents)
    );
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  }

  function downloadTickets(lotteryId: number) {
    const lotteryIdHexStr = '0x' + lotteryId.toString(16);
    var filecontents = 'txnHash,wallet';
    graphData.lotteries.forEach((lotto: any) => {
      if (lotteryIdHexStr == lotto.id) {
        lotto.tickets.forEach((item: any) => {
          filecontents += `\n${item.txnHash},${item.address}`;
        });
      }
    });
    download(`lottery_${lotteryId}_tickets_${getDateYYYYMMDDhhmmss()}.txt`, filecontents);
  }

  function downloadBids(auctionId: number) {
    const auctionIdHexStr = '0x' + auctionId.toString(16);
    var filecontents = 'txnHash,blockTimestamp,wallet,amount';
    graphData.auctions.forEach((auction: any) => {
      if (auctionIdHexStr == auction.id) {
        auction.bids.forEach((item: any) => {
          filecontents += `\n${item.txnHash},${item.blockTimestamp},${item.bidder},${item.amount}`;
        });
      }
    });
    download(`auction_${auctionId}_bids_${getDateYYYYMMDDhhmmss()}.txt`, filecontents);
  }

  async function downloadPrizes(lotteryId: number) {
    var filecontents = 'nftId,winnerAddress,createdAt,claimedAt';
    var request = fetch(`/api/prizes?action=GetLotteryPrizes&lotteryId=${lotteryId}`);
    toast.promise(request, {
      pending: 'Retrieving prize data...',
      success: 'Success! File ready for download.',
      error: 'Failure! Unable to complete request.',
    });
    let prizeProofEntries: any = await (await request).json();
    prizeProofEntries.forEach((item: any) => {
      filecontents +=
        '\r\n' +
        item.nftId +
        ',' +
        item.winnerAddress +
        ',' +
        item.createdAt +
        ',' +
        item.claimedAt;
    });
    download(`lottery_${lotteryId}_prizes_${getDateYYYYMMDDhhmmss()}.txt`, filecontents);
  }

  if (isLoadingFromDB || isLoadingFromSubgraph) {
    return <LoaderDots />;
  }
  const getLotteryGameStats = (id: number) => {
    for (let lottery of graphData.lotteries) {
      if (parseInt(lottery.id) == id) return lottery;
    }
    return {};
  };
  const getAuctionGameStats = (id: number) => {
    for (let auction of graphData.auctions) {
      if (parseInt(auction.id) == id) return auction;
    }
    return {};
  };
  return (
    <>
      {drops?.map((drop: Drop_include_GamesAndArtist, i) => (
        <div key={i} className='dashboard-game-stats__container'>
          <div
            className='dashboard-game-stats__item nft-tile dashboard-game-stats__tile'
            style={{ textAlign: 'center' }}
          >
            <img src={drop.bannerImageS3Path} width={180} height={180} />
            drop{' '}
            <span className='dashboard-game-stats__id dashboard-game-stats__tile'>{drop.id}</span>
          </div>
          <div className='dashboard-game-stats__item'>
            <table width='500'>
              <tbody>
                {drop.Lotteries.map((lottery, i) => {
                  const stats = getLotteryGameStats(lottery.id);
                  return (
                    <tr key={i} style={{ border: '1px solid gray', height: '140px' }}>
                      <td>
                        lottery <span className='dashboard-game-stats__id'>{lottery.id}</span>
                        <br />
                        status: {stats.status} <br />
                        {stats.status === 'Created' &&
                        new Date(lottery.endTime).getTime() > new Date().getTime() ? (
                          <Countdown
                            className='status__countdown'
                            endTime={new Date(lottery.endTime).getTime()}
                          />
                        ) : (
                          `end: ${new Date(lottery.endTime).toLocaleString()}`
                        )}
                        {stats.tickets?.length > 0 && downloadIcon(() => downloadTickets(lottery.id))}
                      </td>
                      <td>
                        tickets sold: {stats.tickets?.length || 0} <br />
                        revenue (points):{' '}
                        {(stats.tickets?.length || 0) * lottery.costPerTicketPoints} PIXEL
                        <br />
                        revenue (tokens):{' '}
                        {(stats.tickets?.length || 0) * lottery.costPerTicketTokens} SAGE <br />
                        prizes claimed: {stats.claimedPrizes?.length || 0}
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
                  const stats = getAuctionGameStats(auction.id);
                  if (stats.endTime == null) {
                    var endTime = Math.floor(new Date(auction.endTime).getTime() / 1000);
                  } else {
                    var endTime = Number(stats.endTime);
                  }
                  return (
                    <tr key={i} style={{ border: '1px solid gray', height: '140px' }}>
                      <td style={{}}>
                        auction <span className='dashboard-game-stats__id'>{auction.id}</span>{' '}
                        <br />
                        status: {stats.status}
                        <br />
                        {stats.status === 'Created' && endTime > new Date().getTime() ? (
                          <Countdown className='status__countdown' endTime={endTime * 1000} />
                        ) : (
                          `end: ${new Date(endTime * 1000).toLocaleString()}`
                        )}
                        {stats.bids?.length > 0 && downloadIcon(() => downloadBids(auction.id))}
                      </td>
                      <td>
                        bids: {stats.bids?.length || 0} <br />
                        highest bid: {utils.formatUnits(stats.highestBid || 0)} SAGE
                        <br />
                        highest bidder: {shortenAddress(stats.highestBidder)}
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

function downloadIcon(callback: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          backgroundColor: '#161619',
          width: '20px',
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
