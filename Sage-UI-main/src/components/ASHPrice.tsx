import useSageRoutes from '@/hooks/useSageRoutes';
import { useEffect, useState } from 'react';

interface Props {
  callback?: () => any;
}

// SAGE trades far below $0.01, so two-decimal formatting would render $0.00.
// Show two significant digits for small prices instead.
export function formatTokenPriceUSD(price: number): string {
  if (isNaN(price) || price <= 0) return '';
  if (price >= 0.01) return price.toFixed(2);
  const decimals = -Math.floor(Math.log10(price)) + 1;
  return price.toFixed(decimals);
}

export default function ASHPrice({ callback }: Props) {
  const [priceUSD, setPriceUSD] = useState<number>(null);
  const { pushToHowToBuyAsh } = useSageRoutes();
  useEffect(() => {
    // Price comes from the on-chain SAGE/WETH pair on Robinhood mainnet via our
    // own API route — DexScreener doesn't index Robinhood Chain, so it never
    // returned a price for SAGE.
    fetch('/api/sage-price')
      .then((res) => res.json())
      .then(({ priceUsd }) => {
        const price = Number(priceUsd);
        if (!isNaN(price) && price > 0) setPriceUSD(price);
      })
      .catch(() => {
        // price feed unavailable (offline/local dev); leave price blank
      });
  }, []);
  return (
    <div
      onClick={() => {
        pushToHowToBuyAsh();
        callback && callback();
      }}
      className='ash-price'
    >
      $SAGE: {priceUSD === null ? '' : formatTokenPriceUSD(priceUSD)} USD
    </div>
  );
}
