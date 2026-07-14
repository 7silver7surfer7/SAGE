import { useEffect, useMemo, useRef } from 'react';
import { useProvider } from 'wagmi';
import { ethers } from 'ethers';
import {
  createChart,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
} from 'lightweight-charts';
import { parameters } from '@/constants/config';
import useTheme from '@/hooks/useTheme';

interface Point {
  t: string;
  price: number;
}
interface TradePoint {
  side: 'buy' | 'sell';
  ethAmount: number;
  createdAt: string;
}
interface Candle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

// The curve's spot price before any trade (initialVirtualEth 2 / 1.073B
// virtual tokens, per 1M). Anchors the FIRST candle's open so the very first
// buy draws a real body instead of an invisible flat doji.
const INITIAL_PRICE_ETH_PER_M = (2 * 1_000_000) / 1_073_000_000;

const BUCKET_S = 60; // 1-minute candles, pump.fun's default granularity

/** Bucket the raw trade-price series into 1m OHLC candles. */
function toCandles(series: Point[]): Candle[] {
  const sorted = [...series].sort((a, b) => +new Date(a.t) - +new Date(b.t));
  const out: Candle[] = [];
  for (const p of sorted) {
    const bucket = (Math.floor(+new Date(p.t) / 1000 / BUCKET_S) * BUCKET_S) as UTCTimestamp;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, p.price);
      last.low = Math.min(last.low, p.price);
      last.close = p.price;
    } else {
      // gapless tape: open at the previous close; the FIRST candle opens at
      // the curve's initial price so trade #1 has a visible body
      const open = last ? last.close : INITIAL_PRICE_ETH_PER_M;
      out.push({ time: bucket, open, high: Math.max(open, p.price), low: Math.min(open, p.price), close: p.price });
    }
  }
  return out;
}

/** Volume histogram buckets (Σ ETH per minute, colored by net side). */
function toVolume(trades: TradePoint[], dark: boolean) {
  const sorted = [...trades].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const map = new Map<number, { buy: number; sell: number }>();
  for (const t of sorted) {
    const bucket = Math.floor(+new Date(t.createdAt) / 1000 / BUCKET_S) * BUCKET_S;
    const e = map.get(bucket) || { buy: 0, sell: 0 };
    e[t.side] += t.ethAmount;
    map.set(bucket, e);
  }
  return Array.from(map.entries()).map(([time, v]) => ({
    time: time as UTCTimestamp,
    value: v.buy + v.sell,
    color: v.buy >= v.sell ? (dark ? 'rgba(212,252,82,0.5)' : 'rgba(79,117,0,0.5)') : 'rgba(246,96,138,0.5)',
  }));
}

const FACTORY_EVENTS_ABI = [
  'event Bought(address indexed token, address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 fee, uint256 creatorFee)',
  'event Sold(address indexed token, address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 fee, uint256 creatorFee)',
  'function spotPriceWei(address) view returns (uint256)',
];

/**
 * pump.fun-style live candlestick chart. History comes from the recorded
 * trades; the LIVE tape streams straight from the chain — the component
 * subscribes to the factory's Bought/Sold events for this token (1s block
 * watcher), so a trade paints the moment its block lands, no page polling.
 */
export default function CandleChart({
  series,
  trades = [],
  tokenAddress,
  onLiveTrade,
}: {
  series: Point[];
  trades?: TradePoint[];
  tokenAddress: string;
  onLiveTrade?: () => void;
}) {
  const { theme } = useTheme();
  const provider = useProvider();
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lastCandleRef = useRef<Candle | null>(null);

  const candles = useMemo(() => toCandles(series), [series]);
  const volume = useMemo(() => toVolume(trades, theme === 'dark'), [trades, theme]);

  // build / theme the chart
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const dark = theme === 'dark';
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: dark ? '#cfdad2' : '#3c4a42',
        fontFamily: "'Space Grotesk', 'Inter', sans-serif",
      },
      grid: {
        vertLines: { color: dark ? 'rgba(242,247,243,0.06)' : 'rgba(16,22,19,0.06)' },
        horzLines: { color: dark ? 'rgba(242,247,243,0.06)' : 'rgba(16,22,19,0.06)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    });
    const s = chart.addCandlestickSeries({
      // brand-fixed data encoding: lime up, pink down (matches the buy/sell UI)
      upColor: dark ? '#d4fc52' : '#4f7500',
      wickUpColor: dark ? '#d4fc52' : '#4f7500',
      downColor: '#f6608a',
      wickDownColor: '#f6608a',
      borderVisible: false,
      priceFormat: { type: 'price', precision: 6, minMove: 0.000001 },
    });
    // pump.fun-style volume strip along the bottom — visible even when the
    // price tape is a flat hairline
    const vol = chart.addHistogramSeries({
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chartRef.current = chart;
    candlesRef.current = s;
    volumeRef.current = vol;
    return () => {
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
      volumeRef.current = null;
    };
  }, [theme]);

  // (re)load history
  useEffect(() => {
    if (!candlesRef.current) return;
    candlesRef.current.setData(candles);
    volumeRef.current?.setData(volume);
    lastCandleRef.current = candles[candles.length - 1] || null;
    // pump.fun-style viewport: the tape lives in a ~60-bar window anchored at
    // the right — fitContent would stretch a lone candle across the whole
    // plot (comically huge). Bars keep a normal width regardless of count.
    chartRef.current?.timeScale().setVisibleLogicalRange({
      from: candles.length - 60,
      to: candles.length + 3,
    });
  }, [candles, volume, theme]);

  // LIVE tape: chain events → paint the candle the moment the block lands
  useEffect(() => {
    const factoryAddr = parameters.SOCIAL_TOKEN_FACTORY_ADDRESS;
    if (!factoryAddr || !provider || !tokenAddress) return undefined;
    (provider as any).pollingInterval = 1000; // watch new blocks every second
    const factory = new ethers.Contract(factoryAddr, FACTORY_EVENTS_ABI, provider as any);
    const paint = async () => {
      try {
        const spotWei = await factory.spotPriceWei(tokenAddress);
        const price = Number(ethers.utils.formatEther(spotWei.mul(1_000_000))); // ETH per 1M
        const now = (Math.floor(Date.now() / 1000 / BUCKET_S) * BUCKET_S) as UTCTimestamp;
        const last = lastCandleRef.current;
        let candle: Candle;
        if (last && last.time === now) {
          candle = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
        } else {
          const open = last ? last.close : price;
          candle = { time: now, open, high: Math.max(open, price), low: Math.min(open, price), close: price };
        }
        lastCandleRef.current = candle;
        candlesRef.current?.update(candle);
        onLiveTrade?.(); // let the page refresh trades/holders instantly too
      } catch {
        /* transient RPC hiccup — next event repaints */
      }
    };
    const boughtFilter = factory.filters.Bought(tokenAddress);
    const soldFilter = factory.filters.Sold(tokenAddress);
    factory.on(boughtFilter, paint);
    factory.on(soldFilter, paint);
    return () => {
      factory.off(boughtFilter, paint);
      factory.off(soldFilter, paint);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, tokenAddress]);

  if (!series.length)
    return <div className='social-chart social-chart--empty'>No trades yet — the chart starts on the first buy.</div>;

  return <div ref={boxRef} className='social-candles' />;
}
