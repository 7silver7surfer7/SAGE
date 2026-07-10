import { LotteryStats } from '@/store/services/dashboardReducer';
import { msToTime } from '@/utilities/time';
import Countdown from 'react-countdown';
import { toast } from 'react-toastify';

interface LotterySectionProps {
  lotteriesStats: LotteryStats[];
}

export function LotterySection({ lotteriesStats }: LotterySectionProps) {
  const iconSize = 28;

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
    var filecontents = 'wallet,numTicketsPoints,numTicketsCoins';
    lotteriesStats.forEach((lotto) => {
      if (lotteryId == lotto.lotteryId) {
        lotto.participants.forEach((item) => {
          filecontents +=
            '\r\n' + item.walletAddress + ',' + item.numTicketsPoints + ',' + item.numTicketsCoins;
        });
      }
    });
    download(`lottery_${lotteryId}_tickets_${getDateYYYYMMDDhhmmss()}.txt`, filecontents);
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

  return (
    <div className='dark:invert flex-col'>
      {lotteriesStats.map((lottoStats: LotteryStats, i: number) => {
        return (
          <div
            key={i}
            className='m-auto shadow-lg rounded-2xl border shadow-md w-full mt-4 px-6 pt-4 pb-4 mb-0 md:mb-0'
          >
            <div className='flex flex-wrap items-center'>
              {/* ----- column 1: lottery identification ----- */}
              <div className='w-full md:w-1/3'>
                <div
                  onClick={() => {
                    window.location.href = `/drops/${lottoStats.lotteryId}`;
                  }}
                  className='flex items-center text-center justify-center mx-auto w-36 h-36 text-center rounded-md border-solid border-black border-solid border-2 cursor-pointer'
                >
                  drop # {lottoStats.lotteryId}
                </div>
              </div>
              {/* ----- column 2: lottery stats ----- */}
              <div className='w-full md:w-1/3'>
                {/* row 1: participants */}
                <div className='flex flex-wrap items-center my-1'>
                  <div className='w-full md:w-1/4'>
                    {lottoStats.participants.length > 0 ? (
                      <a href='#' onClick={() => downloadTickets(lottoStats.lotteryId)}>
                        <img
                          className='mx-auto'
                          src='/wallet.svg'
                          width={iconSize}
                          height={iconSize}
                          alt=''
                        />
                      </a>
                    ) : (
                      <img
                        className='mx-auto'
                        src='/wallet.svg'
                        width={iconSize}
                        height={iconSize}
                        alt=''
                      />
                    )}
                  </div>
                  <div className='w-full md:w-3/4'>
                    <b>{lottoStats.participants.length}</b> participating wallets
                  </div>
                </div>
                {/* row 2: total tickets */}
                <div className='flex flex-wrap items-center my-1'>
                  <div className='w-full md:w-1/4'>
                    <img
                      className='mx-auto'
                      src='/ticket.svg'
                      width={iconSize}
                      height={iconSize}
                      alt=''
                    />
                  </div>
                  <div className='w-full md:w-3/4'>
                    <b>{lottoStats.numTicketsCoins + lottoStats.numTicketsPoints}</b> tickets sold
                  </div>
                </div>
                {/* rows 3 & 4: tickets breakdown */}
                {lottoStats.numTicketsCoins + lottoStats.numTicketsPoints > 0 ? (
                  <>
                    <div className='flex flex-wrap items-center my-1'>
                      <div className='w-full md:w-1/4'>
                        <img
                          className='mx-auto'
                          src='/pineapple.svg'
                          width={iconSize}
                          height={iconSize}
                          alt=''
                        />
                      </div>
                      <div className='w-full md:w-3/4'>
                        <b>{lottoStats.numTicketsPoints}</b> tickets from points &nbsp;
                        <span className='text-xs'>
                          (
                          {(
                            lottoStats.numTicketsPoints * Number(lottoStats.ticketCostPoints)
                          ).toLocaleString()}{' '}
                          pinas)
                        </span>
                      </div>
                    </div>
                    <div className='flex flex-wrap items-center my-1'>
                      <div className='w-full md:w-1/4'>
                        <img
                          className='mx-auto'
                          src='/money-bag.svg'
                          width={iconSize}
                          height={iconSize}
                          alt=''
                        />
                      </div>
                      <div className='w-full md:w-3/4'>
                        <b>{lottoStats.numTicketsCoins}</b> tickets from coins &nbsp;
                        <span className='text-xs'>
                          (
                          {(
                            (lottoStats.numTicketsCoins * Number(lottoStats.ticketCostCoins)) /
                            10 ** 18
                          ).toLocaleString()}{' '}
                          ftm)
                        </span>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
              {/* ----- column 3: lottery countdown & prizes ----- */}
              <div className='w-full md:w-1/3 px-3 text-center'>
                {'Created' == getLotteryStatus(lottoStats.status) ? (
                  <Countdown
                    date={new Date(lottoStats.closeTime * 1000)}
                    intervalDelay={1000}
                    precision={3}
                    renderer={({ days, total, completed }) => (
                      <div className='row-span-2 col-span-1 lg:row-span-1 lg:col-span-2  flex flex-col items-center text-center justify-center space-y-1 p-4 border-r lg:border-r-0 lg:border-b '>
                        <h1 className='text-sm xl:text-2xl text-red-500 font-bold'>
                          {completed ? 'Closed' : 'Drawing In'}
                        </h1>
                        {completed ? null : (
                          <h1 className='text-lg xl:text-3xl font-bold'>
                            {days > 2 ? days + ' Days' : msToTime(total)}
                          </h1>
                        )}
                      </div>
                    )}
                  />
                ) : (
                  <h1 className='text-sm xl:text-2xl font-bold'>
                    {getLotteryStatus(lottoStats.status)}
                    <br />
                    &nbsp;
                  </h1>
                )}
                {/* row 2: prizes */}
                {lottoStats.prizesDrawn ? (
                  <div className='flex flex-wrap items-center my-1'>
                    <div className='w-full md:w-1/4'>
                      <a href='#' onClick={() => downloadPrizes(lottoStats.lotteryId)}>
                        <img
                          className='float-right mr-3'
                          src='/prize.svg'
                          width={iconSize - 2}
                          alt=''
                        />
                      </a>
                    </div>
                    <div className='w-full md:w-3/4'>
                      <b>{lottoStats.prizesDrawn}</b> - <b>{lottoStats.prizesClaimed}</b> prizes
                      drawn / claimed
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getLotteryStatus(contractVal: number) {
  switch (contractVal) {
    case 0:
      return 'Created';
    case 1:
      return 'Canceled';
    case 2:
      return 'Closed';
    case 3:
      return 'Completed';
    default:
      return;
  }
}