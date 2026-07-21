import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
} from 'lightweight-charts';
import useTheme from '@/hooks/useTheme';

export interface ExtCandle {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Candles for EXTERNAL (foreign-chain) pairs — same visual language as the
 * social CandleChart (lime/pink, volume strip, scroll-friendly gestures) but
 * fed entirely from server-proxied OHLCV instead of a live chain-event tape:
 * we can't subscribe to another chain's RPC from the client, so freshness
 * comes from the caller re-fetching (30s poll) and calling setData again.
 */
export default function ExtCandleChart({ candles }: { candles: ExtCandle[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const dark = theme === 'dark';
    const chart = createChart(el, {
      autoSize: true,
      // same gesture setup as CandleChart: keep drag-pan and pinch, drop the
      // wheel/vertical-drag captures that fight page scrolling
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: { axisPressedMouseMove: true, mouseWheel: false, pinch: true },
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
      upColor: dark ? '#d4fc52' : '#4f7500',
      wickUpColor: dark ? '#d4fc52' : '#4f7500',
      downColor: '#f6608a',
      wickDownColor: '#f6608a',
      borderVisible: false,
      // foreign tokens quote in USD with wildly varying magnitudes — let the
      // engine pick precision from the data
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    });
    const vol = chart.addHistogramSeries({
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
      color: dark ? 'rgba(212,252,82,0.25)' : 'rgba(79,117,0,0.25)',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    seriesRef.current = s;
    volRef.current = vol;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    if (!seriesRef.current || !volRef.current || !candles.length) return;
    seriesRef.current.setData(
      candles.map((k) => ({
        time: k.t as UTCTimestamp,
        open: k.o,
        high: k.h,
        low: k.l,
        close: k.c,
      }))
    );
    volRef.current.setData(candles.map((k) => ({ time: k.t as UTCTimestamp, value: k.v })));
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return <div ref={boxRef} className='dex-ext__chart-box' />;
}
