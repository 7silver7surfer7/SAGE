import { useMemo, useState } from 'react';

interface Point {
  t: string;
  price: number;
}

/**
 * A single-series price area chart for a creator coin — SAGE lime on the dark
 * surface (sequential/brand hue, so no legend or categorical validation
 * needed). Emphasized endpoint, faint baseline grid, crosshair + tooltip on
 * hover. Pure SVG, responsive via viewBox.
 */
export default function PriceChart({ series }: { series: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 240;
  const PAD = { l: 8, r: 8, t: 16, b: 8 };

  const { path, area, pts, min, max } = useMemo(() => {
    if (series.length < 2) return { path: '', area: '', pts: [], min: 0, max: 0 };
    const prices = series.map((p) => p.price);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const span = hi - lo || hi || 1;
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const pts = series.map((p, i) => {
      const x = PAD.l + (i / (series.length - 1)) * iw;
      const y = PAD.t + ih - ((p.price - lo) / span) * ih;
      return { x, y, ...p };
    });
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const area = `${path} L${pts[pts.length - 1].x.toFixed(1)} ${H - PAD.b} L${pts[0].x.toFixed(1)} ${H - PAD.b} Z`;
    return { path, area, pts, min: lo, max: hi };
  }, [series]);

  if (series.length < 2) {
    return <div className='social-chart social-chart--empty'>No trades yet — the chart starts on the first buy.</div>;
  }

  const last = pts[pts.length - 1];
  const active = hover != null ? pts[hover] : last;

  return (
    <div className='social-chart'>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio='none'
        className='social-chart__svg'
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          let nearest = 0;
          let best = Infinity;
          pts.forEach((p, i) => {
            const d = Math.abs(p.x - x);
            if (d < best) { best = d; nearest = i; }
          });
          setHover(nearest);
        }}
      >
        <defs>
          <linearGradient id='priceFill' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor='#d4fc52' stopOpacity='0.32' />
            <stop offset='100%' stopColor='#d4fc52' stopOpacity='0' />
          </linearGradient>
        </defs>
        <path d={area} fill='url(#priceFill)' />
        <path d={path} fill='none' stroke='#d4fc52' strokeWidth='2' vectorEffect='non-scaling-stroke' />
        {/* crosshair */}
        <line
          x1={active.x}
          y1={PAD.t}
          x2={active.x}
          y2={H - PAD.b}
          stroke='#d4fc52'
          strokeOpacity='0.35'
          strokeWidth='1'
          vectorEffect='non-scaling-stroke'
        />
        <circle cx={active.x} cy={active.y} r='4' fill='#d4fc52' stroke='#131917' strokeWidth='2' />
      </svg>
      <div className='social-chart__readout'>
        <span className='social-chart__price'>{active.price.toPrecision(3)} ETH / 1M</span>
        <span className='social-chart__range'>
          low {min.toPrecision(2)} · high {max.toPrecision(2)}
        </span>
      </div>
    </div>
  );
}
