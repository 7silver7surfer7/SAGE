import { useState } from 'react';
import { toast } from 'react-toastify';
import { useSigner } from 'wagmi';
import { sendEth } from '@/utilities/tip';
import {
  useGetVerificationInfoQuery,
  usePurchaseVerificationMutation,
} from '@/store/socialReducer';
import VerifiedBadge from './VerifiedBadge';

const BENEFITS = [
  ['Verified checkmark', 'Shown next to your name everywhere on SAGE Social'],
  ['Edit your posts', 'Fix a typo after posting — edits carry a subtle “edited” label'],
  ['Sell posts as NFTs', 'Images sell in ETH; tweets sell in pixels — collectors mint them to their wallet'],
  ['Collect posts', 'Mint other artists’ posts — pay in ETH or pixels'],
  ['Earn pixels holding SAGE', 'Pixels stream to your wallet every second, on-chain'],
  ['Boost posts', 'Pay ETH to lift a post in the global feed'],
  ['Direct messages', 'Wallet-to-wallet DMs with anyone on the network'],
  ['2× invite capacity', 'Your invite code carries 10 uses instead of 5'],
];

interface Props {
  onClose: () => void;
}

export default function VerificationModal({ onClose }: Props) {
  const { data: info } = useGetVerificationInfoQuery();
  const { data: signer } = useSigner();
  const [purchase] = usePurchaseVerificationMutation();
  const [busy, setBusy] = useState(false);

  // verification is paid in ETH only
  const onBuy = async () => {
    if (!info) return;
    if (!signer) {
      toast.info('Connect your wallet first');
      return;
    }
    const price = info.priceEth;
    setBusy(true);
    const t = toast.loading(`Sending ${price} ETH…`);
    try {
      const txHash = await sendEth(info.treasury, price, signer as any);
      await purchase({ txHash, currency: 'ETH' }).unwrap();
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
        <button className='social-verify__buy' disabled={busy || !info} onClick={onBuy}>
          {info ? `Get verified — ${info.priceEth} ETH ($${info.priceUsd})` : 'Loading price…'}
        </button>
        <p className='social-verify__fine'>
          One-time payment to the SAGE treasury. The price tracks $10 in ETH at the current
          market rate.
        </p>
      </div>
    </div>
  );
}
