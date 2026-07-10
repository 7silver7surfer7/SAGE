import useSageRoutes from '@/hooks/useSageRoutes';
import { SAGE_PRICE_TOKEN_ADDRESS } from '@/constants/config';
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
    fetch(`https://api.dexscreener.com/latest/dex/tokens/${SAGE_PRICE_TOKEN_ADDRESS}`)
      .then((res) => res.json())
      .then(({ pairs }) => {
        const price = Number(pairs?.[0]?.priceUsd);
        if (!isNaN(price)) setPriceUSD(price);
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
