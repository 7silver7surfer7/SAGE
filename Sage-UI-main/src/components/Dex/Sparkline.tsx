interface Props {
  /** price points oldest->newest; renders nothing meaningful with < 2 points */
  points: number[];
  width?: number;
  height?: number;
  /** colors via class — stroke is currentColor so the parent's CSS decides */
  positive: boolean;
}

/**
 * Tiny dependency-free SVG sparkline for the DEX screener's LAST 24H column.
 * Stroke uses currentColor; color comes from the dex-spark--up/--down class.
 */
export default function Sparkline({ points, width = 88, height = 26, positive }: Props) {
  const cls = `dex-spark ${positive ? 'dex-spark--up' : 'dex-spark--down'}`;
  if (points.length < 2) {
    return <svg className={cls} width={width} height={height} viewBox={`0 0 ${width} ${height}`} />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pad = 2;
  const step = (width - pad * 2) / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = pad + i * step;
      const y = pad + (1 - (p - min) / range) * (height - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg className={cls} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={path}
        fill='none'
        stroke='currentColor'
        strokeWidth={1.5}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}
