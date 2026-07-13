import { useState } from 'react';
import { toast } from 'react-toastify';
import { useSigner } from 'wagmi';
import { burnSage } from '@/utilities/tip';
import { useGetBoostInfoQuery, useBoostPostMutation } from '@/store/socialReducer';
import VerificationModal from './VerificationModal';

/**
 * Twitter-style "Boost post": pick a daily budget and a duration; total =
 * daily × days, burned in SAGE. The boost is SOFT — a sustained lift in the
 * ranked feed that fades over the campaign, not a pin. Higher daily budget =
 * stronger lift; more days = longer campaign.
 */
export default function BoostModal({ postId, onClose }: { postId: number; onClose: () => void }) {
  const { data: info } = useGetBoostInfoQuery();
  const { data: signer } = useSigner();
  const [boostPost] = useBoostPostMutation();
  const [daily, setDaily] = useState(10);
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [needVerify, setNeedVerify] = useState(false);

  const totalUsd = daily * days;
  const totalSage = info ? Math.ceil(totalUsd * info.sagePerUsd) : 0;
  // rough reach heuristic for the estimate line — scales with total spend
  const reachLo = Math.round(totalUsd * 20);
  const reachHi = Math.round(totalUsd * 55);

  const go = async () => {
    if (!signer) {
      toast.info('Connect your wallet');
      return;
    }
    if (!info) return;
    setBusy(true);
    const t = toast.loading(`Burning ${totalSage} SAGE to boost…`);
    try {
      const txHash = await burnSage(totalSage, signer as any);
      await boostPost({ postId, txHash, dailyUsd: daily, days }).unwrap();
      toast.update(t, {
        render: `Boosted 🔥 — ${days}-day campaign, surging up the feed`,
        type: 'success',
        isLoading: false,
        autoClose: 5000,
      });
      onClose();
    } catch (err: any) {
      if (err?.data?.needsVerification) {
        setNeedVerify(true);
        toast.dismiss(t);
      } else {
        toast.update(t, {
          render: err?.data?.error || err?.message?.slice(0, 90) || 'Boost failed',
          type: 'error',
          isLoading: false,
          autoClose: 6000,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  if (needVerify) return <VerificationModal onClose={onClose} />;

  return (
    <div className='social-verify__overlay' onClick={onClose}>
      <div className='social-boost' onClick={(e) => e.stopPropagation()}>
        <div className='social-verify__head'>
          <h3>Boost post</h3>
          <button className='social-verify__close' onClick={onClose}>
            ✕
          </button>
        </div>
        <p className='social-verify__blurb'>
          A soft, sustained lift in the feed — your post surfaces for the whole campaign, then
          fades. Higher daily budget lifts harder; more days runs longer.
        </p>

        <div className='social-boost__row'>
          <span>Daily budget</span>
          <b>${daily}</b>
        </div>
        <input
          className='social-boost__slider'
          type='range'
          min={info?.dailyMinUsd ?? 5}
          max={info?.dailyMaxUsd ?? 50}
          step={1}
          value={daily}
          onChange={(e) => setDaily(Number(e.target.value))}
        />

        <div className='social-boost__row'>
          <span>Duration</span>
          <b>
            {days} day{days > 1 ? 's' : ''}
          </b>
        </div>
        <input
          className='social-boost__slider'
          type='range'
          min={info?.daysMin ?? 1}
          max={info?.daysMax ?? 10}
          step={1}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />

        <div className='social-boost__est'>
          <span>Est. daily reach</span>
          <span>
            <b>
              {reachLo.toLocaleString()}–{reachHi.toLocaleString()}
            </b>{' '}
            <span className='social-boost__muted'>
              ${totalUsd} total · {totalSage} SAGE
            </span>
          </span>
        </div>

        <button className='social-boost__cta' disabled={busy || !info} onClick={go}>
          {busy ? 'Boosting…' : `Boost — burn ${totalSage} SAGE`}
        </button>
        <p className='social-verify__fine'>
          Burned SAGE is gone forever. The boost competes in the ranked feed — genuinely popular
          posts can still out-rank it.
        </p>
      </div>
    </div>
  );
}
