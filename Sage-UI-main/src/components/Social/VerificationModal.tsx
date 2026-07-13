import { useState } from 'react';
import { toast } from 'react-toastify';
import { useSigner } from 'wagmi';
import { tipSage, sendEth } from '@/utilities/tip';
import {
  useGetVerificationInfoQuery,
  usePurchaseVerificationMutation,
} from '@/store/socialReducer';
import VerifiedBadge from './VerifiedBadge';

const BENEFITS = [
  ['Verified checkmark', 'Shown next to your name everywhere on SAGE Social'],
  ['Sell posts as NFTs', 'Set a SAGE price; collectors mint your post to their wallet'],
  ['Collect posts', 'Mint other artists’ posts — pay in SAGE or your pixels'],
  ['Collect with pixels', 'Spend the pixels you earn holding SAGE instead of tokens'],
  ['Boost posts', 'Burn SAGE to pin a post to the top of the global feed'],
  ['Direct messages', 'Wallet-to-wallet DMs with anyone on the network'],
  ['3× invite codes', 'More invites to bring your collectors in'],
];

interface Props {
  onClose: () => void;
}

export default function VerificationModal({ onClose }: Props) {
  const { data: info } = useGetVerificationInfoQuery();
  const { data: signer } = useSigner();
  const [purchase] = usePurchaseVerificationMutation();
  const [busy, setBusy] = useState(false);

  const onBuy = async (currency: 'SAGE' | 'ETH') => {
    if (!info) return;
    if (!signer) {
      toast.info('Connect your wallet first');
      return;
    }
    const price = currency === 'ETH' ? info.priceEth : info.priceSage;
    setBusy(true);
    const t = toast.loading(`Sending ${price} ${currency}…`);
    try {
      const txHash =
        currency === 'ETH'
          ? await sendEth(info.treasury, price, signer as any)
          : await tipSage(info.treasury, price, signer as any);
      await purchase({ txHash, currency }).unwrap();
      toast.update(t, {
        render: 'You are verified — welcome to premium ✅',
        type: 'success',
        isLoading: false,
        autoClose: 5000,
      });
      onClose();
    } catch (err: any) {
      toast.update(t, {
        render: err?.data?.error || err?.message?.slice(0, 80) || 'Verification failed',
        type: 'error',
        isLoading: false,
        autoClose: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='social-verify__overlay' onClick={onClose}>
      <div className='social-verify' onClick={(e) => e.stopPropagation()}>
        <div className='social-verify__head'>
          <h3>
            <VerifiedBadge size={22} /> Get verified
          </h3>
          <button className='social-verify__close' onClick={onClose}>
            ✕
          </button>
        </div>
        <p className='social-verify__blurb'>
          Posting is free forever. Verification unlocks the premium, crypto-native side of SAGE
          Social:
        </p>
        <ul className='social-verify__benefits'>
          {BENEFITS.map(([title, detail]) => (
            <li key={title}>
              <b>{title}</b>
              <span>{detail}</span>
            </li>
          ))}
        </ul>
        <button
          className='social-verify__buy'
          disabled={busy || !info}
          onClick={() => onBuy('SAGE')}
        >
          {info ? `Get verified — ${info.priceSage} SAGE ($${info.priceUsd})` : 'Loading price…'}
        </button>
        <button
          className='social-verify__buy social-verify__buy--eth'
          disabled={busy || !info}
          onClick={() => onBuy('ETH')}
        >
          {info ? `or pay ${info.priceEth} ETH ($${info.priceUsd})` : ''}
        </button>
        <p className='social-verify__fine'>
          One-time payment to the SAGE treasury. The price tracks $10 in SAGE at the current
          market rate.
        </p>
      </div>
    </div>
  );
}
