import { useEffect, useRef, useState } from 'react';

/**
 * Streams a SagePoints "pixels" balance up in real time between server reads.
 *
 * On-chain, pointsOf = settled + heldSage × rate × elapsed — a deterministic
 * straight line in time — so the exact value at any instant is just
 *   points + ratePerDay × (secondsSinceFetch / 86400).
 * We extrapolate that locally from the on-chain slope (dailyRateOf), so the
 * number ticks up live without polling the chain. Whenever a fresh
 * (points, ratePerDay) arrives (e.g. a 60s refetch or a balance change), it
 * re-anchors to the authoritative value.
 */
export default function useLivePixels(points: number, ratePerDay: number): number {
  const anchor = useRef({ points, ratePerDay, at: Date.now() });
  const [value, setValue] = useState(points);

  useEffect(() => {
    // re-anchor to the freshly fetched value + slope
    anchor.current = { points, ratePerDay, at: Date.now() };
    setValue(points);
    if (!(ratePerDay > 0)) return undefined;
    const tick = () => {
      const { points: p, ratePerDay: r, at } = anchor.current;
      const elapsedSec = (Date.now() - at) / 1000;
      setValue(Math.floor(p + (r * elapsedSec) / 86400));
    };
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [points, ratePerDay]);

  return value;
}
